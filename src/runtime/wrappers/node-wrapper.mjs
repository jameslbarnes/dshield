#!/usr/bin/env node
/**
 * Node.js Function Wrapper for D-Shield
 *
 * This script runs in a subprocess and:
 * 1. Loads the user's function module
 * 2. Reads the request from stdin (or DSHIELD_REQUEST env var)
 * 3. Executes the handler function
 * 4. Writes the response to stdout as JSON
 *
 * Network calls are automatically routed through the proxy via
 * HTTP_PROXY/HTTPS_PROXY environment variables.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node-wrapper.mjs <entry-point> <handler-name>');
    process.exit(1);
  }

  const [entryPoint, handlerName] = args;

  try {
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
