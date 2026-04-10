/**
 * Auditor Client SDK Types
 */

export type Initiator = 'fetch' | 'xhr' | 'websocket' | 'beacon' | 'image' | 'script' | 'iframe';

export interface ClientEgressLog {
  timestamp: string;
  method: string;
  url: string;
  host: string;
  path: string;
  initiator: Initiator;
  firstParty: boolean;
  stack?: string;
}

export interface AuditorConfig {
  /** App identifier for grouping logs */
  appId: string;

  /** API key for authenticating with Auditor server */
  apiKey: string;

  /** Auditor server endpoint (e.g., 'https://auditor.example.com') */
  endpoint?: string;

  /** Capture requests from third-party scripts (default: true) */
  captureThirdParty?: boolean;

  /** Capture WebSocket connections (default: true) */
  captureWebsockets?: boolean;

  /** Capture resource loads like images, scripts, iframes (default: true) */
  captureResources?: boolean;

  /** Callback for each intercepted request */
  onRequest?: (log: ClientEgressLog) => void;

  /** How often to flush logs to server in ms (default: 5000) */
  flushInterval?: number;

  /** Max logs to buffer before forcing flush (default: 100) */
  maxBufferSize?: number;
}

export interface AuditorInstance {
  /** Initialize the SDK with configuration */
  init(config: AuditorConfig): void;

  /** Get all captured logs */
  getLogs(): ClientEgressLog[];

  /** Clear captured logs */
  clearLogs(): void;

  /** Export logs as JSON file download */
  exportLogs(): void;

  /** Manually flush logs to server */
  flush(): Promise<void>;

  /** Stop capturing and clean up */
  destroy(): void;
}
