/**
 * SendBeacon interceptor
 */

import type { ClientEgressLog } from '../types.js';

let originalSendBeacon: typeof navigator.sendBeacon | null = null;

export function interceptBeacon(onRequest: (log: ClientEgressLog) => void): void {
  if (originalSendBeacon) return; // Already intercepted
  if (!navigator.sendBeacon) return; // Not supported

  originalSendBeacon = navigator.sendBeacon.bind(navigator);

  navigator.sendBeacon = function(url: string | URL, data?: BodyInit | null): boolean {
    const urlStr = url.toString();

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr, window.location.origin);
    } catch {
      parsedUrl = new URL(window.location.origin);
    }

    const log: ClientEgressLog = {
      timestamp: new Date().toISOString(),
      method: 'POST',
      url: urlStr,
      host: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      initiator: 'beacon',
      firstParty: isFirstParty(),
      stack: captureStack(),
    };

    onRequest(log);

    return originalSendBeacon!(url, data);
  };
}

export function restoreBeacon(): void {
  if (originalSendBeacon) {
    navigator.sendBeacon = originalSendBeacon;
    originalSendBeacon = null;
  }
}

function isFirstParty(): boolean {
  const stack = new Error().stack || '';
  const lines = stack.split('\n').slice(3);
  for (const line of lines) {
    if (line.includes('http') && !line.includes(window.location.origin)) {
      return false;
    }
  }
  return true;
}

function captureStack(): string {
  const stack = new Error().stack || '';
  return stack.split('\n').slice(3).join('\n');
}
