/**
 * XMLHttpRequest interceptor
 */

import type { ClientEgressLog } from '../types.js';

let originalXHR: typeof XMLHttpRequest | null = null;

export function interceptXHR(onRequest: (log: ClientEgressLog) => void): void {
  if (originalXHR) return; // Already intercepted

  originalXHR = window.XMLHttpRequest;

  const XHRProxy = function(this: XMLHttpRequest) {
    const xhr = new originalXHR!();
    let method = 'GET';
    let url = '';
    const stack = captureStack();

    const originalOpen = xhr.open;
    xhr.open = function(
      reqMethod: string,
      reqUrl: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      method = reqMethod;
      url = reqUrl.toString();
      return originalOpen.call(xhr, reqMethod, reqUrl, async ?? true, username, password);
    };

    const originalSend = xhr.send;
    xhr.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
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
        initiator: 'xhr',
        firstParty: isFirstParty(stack),
        stack,
      };

      onRequest(log);

      return originalSend.call(xhr, body);
    };

    return xhr;
  } as unknown as typeof XMLHttpRequest;

  // Copy static properties
  XHRProxy.prototype = originalXHR.prototype;
  XHRProxy.UNSENT = originalXHR.UNSENT;
  XHRProxy.OPENED = originalXHR.OPENED;
  XHRProxy.HEADERS_RECEIVED = originalXHR.HEADERS_RECEIVED;
  XHRProxy.LOADING = originalXHR.LOADING;
  XHRProxy.DONE = originalXHR.DONE;

  window.XMLHttpRequest = XHRProxy;
}

export function restoreXHR(): void {
  if (originalXHR) {
    window.XMLHttpRequest = originalXHR;
    originalXHR = null;
  }
}

function isFirstParty(stack: string): boolean {
  const lines = stack.split('\n');
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
