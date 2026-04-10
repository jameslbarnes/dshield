export interface EgressLogEntry {
  sequence: number;
  functionId: string;
  invocationId: string;
  timestamp: string;
  method: string;
  host: string;
  port: number;
  path: string;
  protocol: 'http' | 'https';
  source?: 'tee' | 'client'; // 'tee' for TEE-attested, 'client' for self-reported
  initiator?: string; // For client logs: 'fetch', 'xhr', 'websocket', etc.
  // Database write detection
  dbWrite?: {
    provider: string; // 'firestore', 'supabase', 'planetscale', 'turso', 'unknown'
    fields: string[]; // Field names being written
    collection?: string; // Table/collection name if detected
  };
}

export interface SignedLogEntry extends EgressLogEntry {
  signature: string;
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
