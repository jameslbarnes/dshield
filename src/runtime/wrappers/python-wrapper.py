#!/usr/bin/env python3
"""
Python Function Wrapper for D-Shield

This script runs in a subprocess and:
1. Patches urllib to log all outbound requests
2. Loads the user's function module
3. Reads the request from stdin (or DSHIELD_REQUEST env var)
4. Executes the handler function
5. Writes the response to stdout as JSON

ALL outbound HTTP/HTTPS requests are intercepted, logged, and reported back.
"""

import sys
import os
import json
import importlib.util
import traceback
import hashlib
import time
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.parse import urlparse
import urllib.request

# Collect egress logs during execution
egress_logs = []

# Store original urlopen
_original_urlopen = urllib.request.urlopen


def patch_urllib():
    """Patch urllib.request.urlopen to log all outbound requests."""
    function_id = os.environ.get("DSHIELD_FUNCTION_ID", "unknown")
    invocation_id = os.environ.get("DSHIELD_INVOCATION_ID", "unknown")

    def logging_urlopen(url, data=None, timeout=None, **kwargs):
        """Wrapper around urlopen that logs all requests."""
        global egress_logs

        # Parse URL
        if isinstance(url, Request):
            url_str = url.full_url
            method = url.get_method()
        else:
            url_str = str(url)
            method = "POST" if data else "GET"

        parsed = urlparse(url_str)
        timestamp = datetime.utcnow().isoformat() + "Z"

        # Build log entry
        log_entry = {
            "timestamp": timestamp,
            "method": method,
            "url": url_str,
            "host": parsed.hostname or "unknown",
            "path": parsed.path or "/",
            "protocol": parsed.scheme or "https",
            "functionId": function_id,
            "invocationId": invocation_id,
            "sequence": len(egress_logs) + 1,
        }

        # Make the actual request
        start_time = time.time()
        status_code = None
        error = None

        try:
            # Call original urlopen with all arguments
            if timeout is not None:
                response = _original_urlopen(url, data=data, timeout=timeout, **kwargs)
            else:
                response = _original_urlopen(url, data=data, **kwargs)
            status_code = response.status
            return response
        except Exception as e:
            error = str(e)
            raise
        finally:
            # Complete log entry
            log_entry["durationMs"] = int((time.time() - start_time) * 1000)
            if status_code:
                log_entry["statusCode"] = status_code
            if error:
                log_entry["error"] = error

            # Create signature (hash for integrity)
            data_to_sign = json.dumps({k: v for k, v in log_entry.items() if k != "signature"})
            log_entry["signature"] = hashlib.sha256(data_to_sign.encode()).hexdigest()

            egress_logs.append(log_entry)

            # Log to stderr for visibility
            print(f"[EGRESS] {method} {url_str} -> {status_code or error}", file=sys.stderr)

    # Replace urlopen globally
    urllib.request.urlopen = logging_urlopen


def main():
    global egress_logs

    if len(sys.argv) < 3:
        print("Usage: python-wrapper.py <entry-point> <handler-name>", file=sys.stderr)
        sys.exit(1)

    entry_point = sys.argv[1]
    handler_name = sys.argv[2]

    try:
        # Patch urllib BEFORE loading user code
        patch_urllib()

        # Read request from environment variable or stdin
        request_json = os.environ.get("DSHIELD_REQUEST")

        if not request_json:
            # Read from stdin
            request_json = sys.stdin.read()

        if not request_json:
            request_json = "{}"

        request = json.loads(request_json)

        # Load the user's module
        module_path = os.path.abspath(entry_point)
        spec = importlib.util.spec_from_file_location("user_module", module_path)

        if spec is None or spec.loader is None:
            raise ImportError(f"Could not load module: {module_path}")

        user_module = importlib.util.module_from_spec(spec)
        sys.modules["user_module"] = user_module
        spec.loader.exec_module(user_module)

        # Get the handler function
        if not hasattr(user_module, handler_name):
            raise AttributeError(f"Handler '{handler_name}' not found in module")

        handler = getattr(user_module, handler_name)

        if not callable(handler):
            raise TypeError(f"Handler '{handler_name}' is not callable")

        # Execute the handler
        result = handler(request)

        # Handle async functions
        if hasattr(result, "__await__"):
            import asyncio
            result = asyncio.run(result)

        # Normalize the response
        response = normalize_response(result)

        # Add egress logs to response
        response["_egressLogs"] = egress_logs

        # Write response to stdout
        print(json.dumps(response))
        sys.exit(0)

    except Exception as e:
        # Write error response
        error_response = {
            "statusCode": 500,
            "body": {
                "error": str(e),
                "traceback": traceback.format_exc(),
            },
            "_egressLogs": egress_logs,
        }

        print(json.dumps(error_response))
        sys.exit(0)  # Exit 0 so the parent can read the error response


def normalize_response(result):
    """Normalize the handler result to a FunctionResponse."""
    # If result is already a proper response object (dict with statusCode)
    if isinstance(result, dict) and "statusCode" in result:
        return {
            "statusCode": result.get("statusCode", 200),
            "headers": result.get("headers", {}),
            "body": result.get("body"),
        }

    # If result is just data, wrap it
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": result,
    }


if __name__ == "__main__":
    main()
