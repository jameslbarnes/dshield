/**
 * WebSocket interceptor
 */

import type { ClientEgressLog } from '../types.js';

let originalWebSocket: typeof WebSocket | null = null;

export function interceptWebSocket(onRequest: (log: ClientEgressLog) => void): void {
  if (originalWebSocket) return; // Already intercepted

  originalWebSocket = window.WebSocket;

  const WebSocketProxy = function(this: WebSocket, url: string | URL, protocols?: string | string[]) {
    const stack = captureStack();
    const urlStr = url.toString();

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      parsedUrl = new URL(window.location.origin);
    }

    const log: ClientEgressLog = {
      timestamp: new Date().toISOString(),
      method: 'CONNECT',
      url: urlStr,
      host: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      initiator: 'websocket',
      firstParty: isFirstParty(stack),
      stack,
    };

    onRequest(log);

    return new originalWebSocket!(url, protocols);
  } as unknown as typeof WebSocket;

  // Copy static properties and prototype
  WebSocketProxy.prototype = originalWebSocket.prototype;
  WebSocketProxy.CONNECTING = originalWebSocket.CONNECTING;
  WebSocketProxy.OPEN = originalWebSocket.OPEN;
  WebSocketProxy.CLOSING = originalWebSocket.CLOSING;
  WebSocketProxy.CLOSED = originalWebSocket.CLOSED;

  window.WebSocket = WebSocketProxy;
}

export function restoreWebSocket(): void {
  if (originalWebSocket) {
    window.WebSocket = originalWebSocket;
    originalWebSocket = null;
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
  return stack.split('\n').slice(2).join('\n');
}
