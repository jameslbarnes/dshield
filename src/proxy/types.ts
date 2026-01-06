/**
 * Base log entry with common fields.
 */
export interface BaseLogEntry {
  type: 'egress' | 'request' | 'response';
  sequence: number;
  functionId: string;
  invocationId: string;
  timestamp: string;
}

/**
 * Egress log entry - outbound API calls from functions.
 */
export interface EgressLogEntry extends BaseLogEntry {
  type: 'egress';
  method: string;
  host: string;
  port: number;
  path: string;
  protocol: 'http' | 'https';
}

/**
 * Request log entry - incoming requests to the server.
 */
export interface RequestLogEntry extends BaseLogEntry {
  type: 'request';
  method: string;
  path: string;
  sourceIp: string;
  clientId?: string;
  requestSize: number;
  requestHash: string;
}

/**
 * Response log entry - responses sent back to clients.
 */
export interface ResponseLogEntry extends BaseLogEntry {
  type: 'response';
  requestSeq: number;
  status: number;
  responseSize: number;
  responseHash: string;
  durationMs: number;
}

/**
 * Union of all log entry types.
 */
export type LogEntry = EgressLogEntry | RequestLogEntry | ResponseLogEntry;

/**
 * Signed log entry - any log entry with a signature.
 */
export interface SignedLogEntry extends BaseLogEntry {
  signature: string;
  // Include all possible fields from different entry types
  method?: string;
  host?: string;
  port?: number;
  path?: string;
  protocol?: 'http' | 'https';
  sourceIp?: string;
  clientId?: string;
  requestSize?: number;
  requestHash?: string;
  requestSeq?: number;
  status?: number;
  responseSize?: number;
  responseHash?: string;
  durationMs?: number;
}

export interface LogStore {
  append(entry: SignedLogEntry): Promise<void>;
  getAll(functionId: string): Promise<SignedLogEntry[]>;
  getLatestSequence(functionId: string): Promise<number>;
}

export interface Signer {
  sign(data: string): string;
  getPublicKey(): string;
}

export interface ProxyConfig {
  listenPort: number;
  functionId: string;
  logStore: LogStore;
  signer: Signer;
}

export interface ProxyRequest {
  method: string;
  host: string;
  port: number;
  path: string;
  protocol: 'http' | 'https';
  headers: Record<string, string | string[] | undefined>;
  body?: Buffer;
}
