/**
 * Auditor Client SDK
 *
 * Transparent egress logging for client-side applications.
 * Trust model: "Declared egress, publicly verifiable"
 */

import type { AuditorConfig, AuditorInstance, ClientEgressLog } from './types.js';
import { interceptFetch, restoreFetch } from './interceptors/fetch.js';
import { interceptXHR, restoreXHR } from './interceptors/xhr.js';
import { interceptWebSocket, restoreWebSocket } from './interceptors/websocket.js';
import { interceptBeacon, restoreBeacon } from './interceptors/beacon.js';
import { interceptResources, restoreResources } from './interceptors/resources.js';
import { Reporter } from './reporter.js';

export type { AuditorConfig, AuditorInstance, ClientEgressLog, Initiator } from './types.js';

let logs: ClientEgressLog[] = [];
let config: AuditorConfig | null = null;
let reporter: Reporter | null = null;
let initialized = false;

function handleRequest(log: ClientEgressLog): void {
  logs.push(log);

  // Call user callback if provided
  config?.onRequest?.(log);

  // Send to reporter if configured
  if (reporter) {
    reporter.add(log);
  }
}

const Auditor: AuditorInstance = {
  init(userConfig: AuditorConfig): void {
    if (initialized) {
      console.warn('[Auditor] Already initialized');
      return;
    }

    config = {
      captureThirdParty: true,
      captureWebsockets: true,
      captureResources: true,
      flushInterval: 5000,
      maxBufferSize: 100,
      ...userConfig,
    };

    // Store original fetch for reporter to use
    (window as { __auditor_original_fetch?: typeof fetch }).__auditor_original_fetch = window.fetch;

    // Set up interceptors
    interceptFetch(handleRequest);
    interceptXHR(handleRequest);

    if (config.captureWebsockets) {
      interceptWebSocket(handleRequest);
    }

    interceptBeacon(handleRequest);

    if (config.captureResources) {
      interceptResources(handleRequest);
    }

    // Set up reporter if endpoint is configured
    if (config.endpoint) {
      reporter = new Reporter({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        appId: config.appId,
        flushInterval: config.flushInterval!,
        maxBufferSize: config.maxBufferSize!,
      });
    }

    initialized = true;
    console.log('[Auditor] Initialized for app:', config.appId);
  },

  getLogs(): ClientEgressLog[] {
    return [...logs];
  },

  clearLogs(): void {
    logs = [];
  },

  exportLogs(): void {
    const data = JSON.stringify(logs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `auditor-logs-${config?.appId || 'unknown'}-${new Date().toISOString()}.json`;
    a.click();

    URL.revokeObjectURL(url);
  },

  async flush(): Promise<void> {
    if (reporter) {
      await reporter.flush();
    }
  },

  destroy(): void {
    if (!initialized) return;

    restoreFetch();
    restoreXHR();
    restoreWebSocket();
    restoreBeacon();
    restoreResources();

    if (reporter) {
      reporter.destroy();
      reporter = null;
    }

    delete (window as { __auditor_original_fetch?: typeof fetch }).__auditor_original_fetch;

    logs = [];
    config = null;
    initialized = false;

    console.log('[Auditor] Destroyed');
  },
};

// Export for both ESM and UMD
export { Auditor };
export default Auditor;
