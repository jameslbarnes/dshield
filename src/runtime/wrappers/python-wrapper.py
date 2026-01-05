#!/usr/bin/env python3
"""
Python Function Wrapper for D-Shield

This script runs in a subprocess and:
1. Loads the user's function module
2. Reads the request from stdin (or DSHIELD_REQUEST env var)
3. Executes the handler function
4. Writes the response to stdout as JSON

Network calls are automatically routed through the proxy via
HTTP_PROXY/HTTPS_PROXY environment variables.
"""

import sys
import os
import json
import importlib.util
import traceback


def main():
    if len(sys.argv) < 3:
        print("Usage: python-wrapper.py <entry-point> <handler-name>", file=sys.stderr)
        sys.exit(1)

    entry_point = sys.argv[1]
    handler_name = sys.argv[2]

    try:
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
