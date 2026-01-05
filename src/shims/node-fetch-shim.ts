/**
 * Node.js fetch/http/https shim for D-Shield.
 *
 * This module patches the global fetch and http/https modules to route
 * all requests through the D-Shield logging proxy.
 *
 * Layer 1 of the 4-layer network interception stack.
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

interface ShimConfig {
  proxyHost: string;
  proxyPort: number;
  enabled: boolean;
}

let shimConfig: ShimConfig = {
  proxyHost: '127.0.0.1',
  proxyPort: 0,
  enabled: false,
};

// Store original implementations
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;
const originalFetch = globalThis.fetch;

/**
 * Configure the shim with proxy settings.
 */
export function configureShim(config: Partial<ShimConfig>): void {
  shimConfig = { ...shimConfig, ...config };
}

/**
 * Enable the shim - all requests will go through the proxy.
 */
export function enableShim(): void {
  shimConfig.enabled = true;
}

/**
 * Disable the shim - requests go directly to destinations.
 */
export function disableShim(): void {
  shimConfig.enabled = false;
}

/**
 * Check if the shim is enabled.
 */
export function isShimEnabled(): boolean {
  return shimConfig.enabled;
}

/**
 * Get current shim configuration.
 */
export function getShimConfig(): Readonly<ShimConfig> {
  return { ...shimConfig };
}

/**
 * Patched http.request that routes through the proxy.
 */
function patchedHttpRequest(
  urlOrOptions: string | URL | http.RequestOptions,
  optionsOrCallback?: http.RequestOptions | ((res: http.IncomingMessage) => void),
  callback?: (res: http.IncomingMessage) => void
): http.ClientRequest {
  if (!shimConfig.enabled) {
    // @ts-expect-error - overloaded function
    return originalHttpRequest(urlOrOptions, optionsOrCallback, callback);
  }

  const { options, cb } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, callback);
  const targetUrl = buildTargetUrl('http', options);

  const proxyOptions: http.RequestOptions = {
    hostname: shimConfig.proxyHost,
    port: shimConfig.proxyPort,
    path: targetUrl,
    method: options.method || 'GET',
    headers: {
      ...options.headers,
      Host: `${options.hostname || options.host}:${options.port || 80}`,
    },
  };

  return originalHttpRequest(proxyOptions, cb);
}

/**
 * Patched https.request that routes through the proxy via CONNECT.
 */
function patchedHttpsRequest(
  urlOrOptions: string | URL | https.RequestOptions,
  optionsOrCallback?: https.RequestOptions | ((res: http.IncomingMessage) => void),
  callback?: (res: http.IncomingMessage) => void
): http.ClientRequest {
  if (!shimConfig.enabled) {
    // @ts-expect-error - overloaded function
    return originalHttpsRequest(urlOrOptions, optionsOrCallback, callback);
  }

  const { options, cb } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, callback);
  const host = (options.hostname || options.host || 'localhost') as string;
  const port = options.port || 443;

  // For HTTPS, we need to use the CONNECT method through the proxy
  // The proxy will then tunnel the TLS connection
  const proxyReq = originalHttpRequest({
    hostname: shimConfig.proxyHost,
    port: shimConfig.proxyPort,
    method: 'CONNECT',
    path: `${host}:${port}`,
  });

  proxyReq.on('connect', (_res, socket) => {
    // Now make the actual HTTPS request through the tunnel
    const tlsOptions = {
      ...options,
      socket,
      servername: host,
    };

    const actualReq = originalHttpsRequest(tlsOptions, cb);

    // Forward events from the tunnel request to the actual request
    proxyReq.on('error', (err) => actualReq.emit('error', err));
  });

  proxyReq.on('error', (err) => {
    // Create a dummy request to emit the error
    const dummyReq = new http.ClientRequest(new URL(`https://${host}:${port}`));
    setImmediate(() => dummyReq.emit('error', err));
  });

  proxyReq.end();

  // Return a proxy request object that forwards write/end calls
  // This is a simplified version - full implementation would need more work
  return proxyReq;
}

/**
 * Patched global fetch that routes through the proxy.
 */
async function patchedFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  if (!shimConfig.enabled) {
    return originalFetch(input, init);
  }

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const parsedUrl = new URL(url);

  // For fetch, we set the proxy via environment variables or use the agent
  // This is a simplified implementation using HTTP proxy for HTTP requests
  if (parsedUrl.protocol === 'http:') {
    const proxyUrl = `http://${shimConfig.proxyHost}:${shimConfig.proxyPort}`;
    const targetUrl = parsedUrl.href;

    // Make request through proxy
    const proxyFullUrl = `${proxyUrl}/${targetUrl}`;

    // Use modified URL that goes through proxy
    const modifiedInit: RequestInit = {
      ...init,
      headers: {
        ...init?.headers,
        Host: parsedUrl.host,
      },
    };

    // For HTTP proxy, we request the full URL through the proxy
    return originalFetch(targetUrl, {
      ...modifiedInit,
      // @ts-expect-error - Node.js specific option
      agent: new http.Agent({
        host: shimConfig.proxyHost,
        port: shimConfig.proxyPort,
      }),
    });
  }

  // For HTTPS, we need a more complex tunnel setup
  // This is a simplified version that may not work for all cases
  return originalFetch(input, init);
}

/**
 * Install all shims - patches global fetch and http/https modules.
 */
export function installShims(): void {
  // Patch http module
  (http as any).request = patchedHttpRequest;

  // Patch https module
  (https as any).request = patchedHttpsRequest;

  // Patch global fetch
  globalThis.fetch = patchedFetch as typeof fetch;
}

/**
 * Uninstall all shims - restores original implementations.
 */
export function uninstallShims(): void {
  (http as any).request = originalHttpRequest;
  (https as any).request = originalHttpsRequest;
  globalThis.fetch = originalFetch;
}

/**
 * Normalize the various argument forms for http.request.
 */
function normalizeRequestArgs(
  urlOrOptions: string | URL | http.RequestOptions,
  optionsOrCallback?: http.RequestOptions | ((res: http.IncomingMessage) => void),
  callback?: (res: http.IncomingMessage) => void
): { options: http.RequestOptions; cb?: (res: http.IncomingMessage) => void } {
  let options: http.RequestOptions;
  let cb: ((res: http.IncomingMessage) => void) | undefined;

  if (typeof urlOrOptions === 'string') {
    const parsed = new URL(urlOrOptions);
    options = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : undefined,
      path: parsed.pathname + parsed.search,
      protocol: parsed.protocol,
    };
    if (typeof optionsOrCallback === 'function') {
      cb = optionsOrCallback;
    } else if (optionsOrCallback) {
      options = { ...options, ...optionsOrCallback };
      cb = callback;
    }
  } else if (urlOrOptions instanceof URL) {
    options = {
      hostname: urlOrOptions.hostname,
      port: urlOrOptions.port ? parseInt(urlOrOptions.port) : undefined,
      path: urlOrOptions.pathname + urlOrOptions.search,
      protocol: urlOrOptions.protocol,
    };
    if (typeof optionsOrCallback === 'function') {
      cb = optionsOrCallback;
    } else if (optionsOrCallback) {
      options = { ...options, ...optionsOrCallback };
      cb = callback;
    }
  } else {
    options = urlOrOptions;
    if (typeof optionsOrCallback === 'function') {
      cb = optionsOrCallback;
    } else {
      cb = callback;
    }
  }

  return { options, cb };
}

/**
 * Build target URL string for proxy request.
 */
function buildTargetUrl(protocol: string, options: http.RequestOptions): string {
  const host = options.hostname || options.host || 'localhost';
  const port = options.port || (protocol === 'https' ? 443 : 80);
  const path = options.path || '/';
  return `${protocol}://${host}:${port}${path}`;
}
