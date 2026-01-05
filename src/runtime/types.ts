/**
 * D-Shield Runtime Types
 */

export interface FunctionConfig {
  /** Unique identifier for this function */
  id: string;

  /** Display name */
  name: string;

  /** Path to the function code (JS/TS file or Python file) */
  entryPoint: string;

  /** Runtime: 'node' or 'python' */
  runtime: 'node' | 'python';

  /** Handler function name (default: 'handler') */
  handler?: string;

  /** Environment variables to pass to the function */
  env?: Record<string, string>;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Memory limit in MB (default: 128) */
  memoryLimit?: number;
}

export interface RuntimeConfig {
  /** Port for the HTTP server to listen on */
  port: number;

  /** Function configurations */
  functions: FunctionConfig[];

  /** Log storage configuration */
  logStorage: LogStorageConfig;

  /** TEE signer configuration */
  signer: SignerConfig;
}

export interface LogStorageConfig {
  /** Storage type */
  type: 'memory' | 'firestore';

  /** Firestore project ID (if type is 'firestore') */
  projectId?: string;

  /** Firestore collection name (if type is 'firestore') */
  collection?: string;
}

export interface SignerConfig {
  /** Signer type */
  type: 'ephemeral' | 'tee';

  /** Path to private key PEM file (optional, for testing) */
  privateKeyPath?: string;
}

export interface FunctionRequest {
  /** Request ID */
  id: string;

  /** Function ID to invoke */
  functionId: string;

  /** HTTP method */
  method: string;

  /** Request path */
  path: string;

  /** Request headers */
  headers: Record<string, string>;

  /** Request body (parsed JSON or raw string) */
  body?: unknown;

  /** Query parameters */
  query?: Record<string, string>;
}

export interface FunctionResponse {
  /** HTTP status code */
  statusCode: number;

  /** Response headers */
  headers?: Record<string, string>;

  /** Response body */
  body?: unknown;
}

export interface FunctionResult {
  /** Whether the function executed successfully */
  success: boolean;

  /** Response from the function (if successful) */
  response?: FunctionResponse;

  /** Error message (if failed) */
  error?: string;

  /** Execution time in milliseconds */
  durationMs: number;

  /** Invocation ID for log correlation */
  invocationId: string;
}

export interface InvocationContext {
  /** Unique invocation ID */
  invocationId: string;

  /** Function ID */
  functionId: string;

  /** Start timestamp */
  startTime: Date;

  /** Request details */
  request: FunctionRequest;
}
