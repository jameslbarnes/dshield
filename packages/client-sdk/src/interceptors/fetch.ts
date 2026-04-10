/**
 * Fetch API interceptor
 */

import type { ClientEgressLog } from '../types.js';

let originalFetch: typeof fetch | null = null;

export function interceptFetch(onRequest: (log: ClientEgressLog) => void): void {
  if (originalFetch) return; // Already intercepted

  originalFetch = window.fetch;

  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method || (input instanceof Request ? input.method : 'GET');

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url, window.location.origin);
    } catch {
      parsedUrl = new URL(window.location.origin);
    }

    const log: ClientEgressLog = {
      timestamp: new Date().toISOString(),
      method: method.toUpperCase(),
      url,
      host: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      initiator: 'fetch',
      firstParty: isFirstParty(),
      stack: captureStack(),
    };

    onRequest(log);

    return originalFetch!.call(window, input, init);
  };
}

export function restoreFetch(): void {
  if (originalFetch) {
    window.fetch = originalFetch;
    originalFetch = null;
  }
}

function isFirstParty(): boolean {
  // Check if the call originated from first-party code
  // by examining the stack trace
  const stack = new Error().stack || '';
  const lines = stack.split('\n').slice(3); // Skip interceptor frames

  // If the call comes from an external domain's script, mark as third-party
  for (const line of lines) {
    if (line.includes('http') && !line.includes(window.location.origin)) {
      return false;
    }
  }
  return true;
}

function captureStack(): string {
  const stack = new Error().stack || '';
  // Remove the first few lines (interceptor internals)
  return stack.split('\n').slice(3).join('\n');
}
