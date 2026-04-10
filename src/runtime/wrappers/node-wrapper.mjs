#!/usr/bin/env node
/**
 * Node.js Function Wrapper for D-Shield
 *
 * This script runs in a subprocess and:
 * 1. Patches global fetch to log all outbound requests
 * 2. Loads the user's function module
 * 3. Reads the request from stdin (or DSHIELD_REQUEST env var)
 * 4. Executes the handler function
 * 5. Writes the response to stdout as JSON
 *
 * ALL outbound HTTP/HTTPS requests are intercepted, logged, and reported back.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import crypto from 'node:crypto';

// Collect egress logs during execution
const egressLogs = [];

/**
 * Detect database provider from hostname.
 */
function detectDbProvider(hostname) {
  if (hostname.includes('firestore.googleapis.com')) return 'firestore';
  if (hostname.includes('supabase.co')) return 'supabase';
  if (hostname.includes('psdb.cloud') || hostname.includes('planetscale')) return 'planetscale';
  if (hostname.includes('turso.io')) return 'turso';
  if (hostname.includes('mongodb.com') || hostname.includes('mongodb.net')) return 'mongodb';
  if (hostname.includes('fauna.com')) return 'fauna';
  if (hostname.includes('upstash.io')) return 'upstash';
  if (hostname.includes('neon.tech')) return 'neon';
  return null;
}

/**
 * Extract field names from a JSON object (recursive, top-level keys only for data).
 */
function extractFields(obj, prefix = '') {
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return [];

  const fields = [];
  for (const key of Object.keys(obj)) {
    fields.push(prefix ? `${prefix}.${key}` : key);
  }
  return fields;
}

/**
 * Extract collection/table name from path based on provider.
 */
function extractCollection(path, provider) {
  try {
    const segments = path.split('/').filter(Boolean);

    if (provider === 'firestore') {
      // Firestore: /v1/projects/{proj}/databases/{db}/documents/{collection}/{doc}
      const docIndex = segments.indexOf('documents');
      if (docIndex !== -1 && segments[docIndex + 1]) {
        return segments[docIndex + 1];
      }
    }

    if (provider === 'supabase') {
      // Supabase REST: /rest/v1/{table}
      const restIndex = segments.indexOf('v1');
      if (restIndex !== -1 && segments[restIndex + 1]) {
        return segments[restIndex + 1].split('?')[0];
      }
    }

    // Generic: last path segment before query params
    const lastSegment = segments[segments.length - 1];
    if (lastSegment) {
      return lastSegment.split('?')[0];
    }
  } catch {
    // Ignore parsing errors
  }
  return null;
}

/**
 * Detect database write and extract fields from request body.
 */
function detectDbWrite(hostname, method, path, body) {
  // Only detect writes (POST, PUT, PATCH)
  if (!['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    return null;
  }

  const provider = detectDbProvider(hostname);
  if (!provider && !body) return null;

  // Try to parse the body and extract fields
  let fields = [];
  let parsedBody = null;

  if (body) {
    try {
      // Handle string body
      const bodyStr = typeof body === 'string' ? body :
                      body instanceof Buffer ? body.toString() :
                      typeof body === 'object' ? JSON.stringify(body) : null;

      if (bodyStr) {
        parsedBody = JSON.parse(bodyStr);

        // For Firestore, look for fields in specific structure
        if (provider === 'firestore' && parsedBody.fields) {
          fields = extractFields(parsedBody.fields);
        } else if (parsedBody) {
          // Generic field extraction
          fields = extractFields(parsedBody);
        }
      }
    } catch {
      // Not JSON or can't parse - that's fine
    }
  }

  // Only return dbWrite if we detected a provider OR extracted fields
  if (provider || fields.length > 0) {
    return {
      provider: provider || 'unknown',
      fields,
      collection: extractCollection(path, provider)
    };
  }

  return null;
}

/**
 * Patch global fetch to log all outbound requests.
 * This ensures ALL outbound requests are captured.
 */
function patchFetch() {
  const originalFetch = globalThis.fetch;
  const functionId = process.env.DSHIELD_FUNCTION_ID || 'unknown';
  const invocationId = process.env.DSHIELD_INVOCATION_ID || 'unknown';

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';
    const timestamp = new Date().toISOString();

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      parsedUrl = { hostname: url, pathname: '/', protocol: 'unknown:' };
    }

    // Detect database write and extract fields
    const dbWrite = detectDbWrite(parsedUrl.hostname, method, parsedUrl.pathname, init.body);

    // Log entry
    const logEntry = {
      timestamp,
      method,
      url,
      host: parsedUrl.hostname,
      path: parsedUrl.pathname,
      protocol: parsedUrl.protocol.replace(':', ''),
      functionId,
      invocationId,
      sequence: egressLogs.length + 1,
      ...(dbWrite && { dbWrite }),
    };

    // Make the actual request
    const startTime = Date.now();
    let response;
    let statusCode;
    let error;

    try {
      response = await originalFetch(input, init);
      statusCode = response.status;
    } catch (e) {
      error = e.message;
      throw e;
    } finally {
      // Complete the log entry
      logEntry.statusCode = statusCode;
      logEntry.durationMs = Date.now() - startTime;
      if (error) logEntry.error = error;

      // Create signature (hash for now, would be TEE signed in production)
      const dataToSign = JSON.stringify({
        ...logEntry,
        signature: undefined
      });
      logEntry.signature = crypto.createHash('sha256').update(dataToSign).digest('hex');

      egressLogs.push(logEntry);

      // Log to stderr for visibility (stdout is reserved for response)
      console.error(`[EGRESS] ${method} ${url} -> ${statusCode || error}`);
    }

    return response;
  };
}

/**
 * Report egress logs to the main server.
 */
async function reportEgressLogs() {
  if (egressLogs.length === 0) return;

  const reportUrl = process.env.DSHIELD_LOG_REPORT_URL;
  if (!reportUrl) {
    console.error('[D-Shield] No log report URL configured, logs not persisted');
    return;
  }

  try {
    // Use the original fetch to report (before we patched it)
    const originalFetch = globalThis._originalFetch || globalThis.fetch;
    await originalFetch(reportUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        functionId: process.env.DSHIELD_FUNCTION_ID,
        invocationId: process.env.DSHIELD_INVOCATION_ID,
        entries: egressLogs
      })
    });
  } catch (e) {
    console.error('[D-Shield] Failed to report egress logs:', e.message);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node-wrapper.mjs <entry-point> <handler-name>');
    process.exit(1);
  }

  const [entryPoint, handlerName] = args;

  try {
    // Store original fetch before patching
    globalThis._originalFetch = globalThis.fetch;

    // Patch fetch BEFORE loading user code
    patchFetch();

    // Read request from environment variable or stdin
    let requestJson = process.env.DSHIELD_REQUEST;

    if (!requestJson) {
      // Read from stdin
      requestJson = await readStdin();
    }

    const request = JSON.parse(requestJson);

    // Load the user's module
    const modulePath = resolve(process.cwd(), entryPoint);
    const moduleUrl = pathToFileURL(modulePath).href;
    const userModule = await import(moduleUrl);

    // Get the handler function
    const handler = userModule[handlerName] || userModule.default?.[handlerName];

    if (typeof handler !== 'function') {
      throw new Error(`Handler '${handlerName}' is not a function`);
    }

    // Execute the handler
    const result = await handler(request);

    // Normalize the response
    const response = normalizeResponse(result);

    // Add egress logs to response metadata
    response._egressLogs = egressLogs;

    // Write response to stdout
    console.log(JSON.stringify(response));

    process.exit(0);
  } catch (error) {
    // Write error response
    const errorResponse = {
      statusCode: 500,
      body: {
        error: error instanceof Error ? error.message : String(error),
      },
      _egressLogs: egressLogs,
    };

    console.log(JSON.stringify(errorResponse));
    process.exit(0); // Exit 0 so the parent can read the error response
  }
}

/**
 * Read all data from stdin.
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      resolve(data);
    });

    // Handle case where stdin is empty or not provided
    setTimeout(() => {
      if (!data) {
        resolve('{}');
      }
    }, 100);
  });
}

/**
 * Normalize the handler result to a FunctionResponse.
 */
function normalizeResponse(result) {
  // If result is already a proper response object
  if (result && typeof result === 'object' && 'statusCode' in result) {
    return {
      statusCode: result.statusCode || 200,
      headers: result.headers || {},
      body: result.body,
    };
  }

  // If result is just data, wrap it
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: result,
  };
}

main().catch((error) => {
  console.error('Wrapper error:', error);
  process.exit(1);
});
