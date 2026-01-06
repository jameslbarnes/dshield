/**
 * D-Shield Transparent Client SDK
 *
 * A minimal SDK that routes ALL client network requests through D-Shield,
 * ensuring complete visibility into client-side data flows.
 *
 * The TEE verifies this SDK is present in the client bundle by checking
 * its hash against the signed manifest. Since all requests go through
 * D-Shield, the server-side egress logs capture everything the client does.
 *
 * Usage:
 *   import { initDShield } from '@dshield/client';
 *   initDShield({ serverUrl: 'https://dshield.example.com' });
 *   // Now all fetch() calls are automatically logged
 */

// Browser type declarations for fetch API
type RequestInfo = string | URL | { url: string };

// SDK version - changes trigger manifest updates
export const SDK_VERSION = '1.0.0';

// SDK identifier for verification
export const SDK_ID = 'dshield-client-sdk';

export interface DShieldConfig {
  /** D-Shield server URL */
  serverUrl: string;
  /** Client ID for request correlation */
  clientId?: string;
  /** Optional: paths to exclude from proxying (e.g., local assets) */
  excludePaths?: string[];
  /** Enable debug logging */
  debug?: boolean;
}

let config: DShieldConfig | null = null;
let originalFetch: typeof fetch | null = null;
let initialized = false;

/**
 * Initialize D-Shield client SDK.
 * This wraps the global fetch to route all requests through D-Shield.
 */
export function initDShield(options: DShieldConfig): void {
  if (initialized) {
    if (options.debug) {
      console.warn('[D-Shield] Already initialized');
    }
    return;
  }

  config = {
    ...options,
    excludePaths: options.excludePaths || [],
  };

  // Store original fetch
  originalFetch = globalThis.fetch;

  // Replace global fetch with proxied version
  globalThis.fetch = proxiedFetch;

  initialized = true;

  if (config.debug) {
    console.log('[D-Shield] Initialized, all fetch requests will be proxied through:', config.serverUrl);
  }
}

/**
 * Check if a URL should be excluded from proxying.
 */
function shouldExclude(url: string): boolean {
  if (!config?.excludePaths) return false;

  for (const pattern of config.excludePaths) {
    if (url.includes(pattern)) return true;
  }
  return false;
}

/**
 * Check if URL is already pointing to D-Shield server.
 */
function isDShieldUrl(url: string): boolean {
  if (!config) return false;
  try {
    const parsed = new URL(url);
    const serverParsed = new URL(config.serverUrl);
    return parsed.hostname === serverParsed.hostname;
  } catch {
    return false;
  }
}

/**
 * Proxied fetch that routes requests through D-Shield.
 */
async function proxiedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!config || !originalFetch) {
    throw new Error('[D-Shield] SDK not initialized. Call initDShield() first.');
  }

  // Get the URL string
  let url: string;
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.toString();
  } else {
    url = input.url;
  }

  // Skip proxying for excluded paths or D-Shield server itself
  if (shouldExclude(url) || isDShieldUrl(url)) {
    return originalFetch(url, init);
  }

  // Skip relative URLs that are local assets
  if (url.startsWith('/') && !url.startsWith('//')) {
    // Check if it's an API path that should be proxied
    if (!url.startsWith('/api/') && !url.startsWith('/v1/') && !url.startsWith('/v2/')) {
      return originalFetch(url, init);
    }
  }

  // Build the proxied request
  const proxyUrl = `${config.serverUrl}/proxy`;

  const headers = new Headers(init?.headers);
  headers.set('X-DShield-Target-URL', url);
  headers.set('X-DShield-SDK-Version', SDK_VERSION);
  if (config.clientId) {
    headers.set('X-DShield-Client-ID', config.clientId);
  }

  if (config.debug) {
    console.log('[D-Shield] Proxying request:', url);
  }

  // Forward the request through D-Shield
  return originalFetch(proxyUrl, {
    ...init,
    method: init?.method || 'GET',
    headers,
    body: init?.body,
  });
}

/**
 * Get SDK info for manifest verification.
 */
export function getSDKInfo(): { id: string; version: string } {
  return {
    id: SDK_ID,
    version: SDK_VERSION,
  };
}

/**
 * Check if SDK is properly initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Disable D-Shield proxying (for testing only).
 */
export function _disable(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
  initialized = false;
  config = null;
}

/**
 * Create a fetch function bound to a specific D-Shield server.
 * Use this if you don't want to modify the global fetch.
 */
export function createDShieldFetch(options: DShieldConfig): typeof fetch {
  const localConfig = {
    ...options,
    excludePaths: options.excludePaths || [],
  };

  return async function dshieldFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = input.url;
    }

    // Build the proxied request
    const proxyUrl = `${localConfig.serverUrl}/proxy`;

    const headers = new Headers(init?.headers);
    headers.set('X-DShield-Target-URL', url);
    headers.set('X-DShield-SDK-Version', SDK_VERSION);
    if (localConfig.clientId) {
      headers.set('X-DShield-Client-ID', localConfig.clientId);
    }

    return fetch(proxyUrl, {
      ...init,
      method: init?.method || 'GET',
      headers,
      body: init?.body,
    });
  };
}
