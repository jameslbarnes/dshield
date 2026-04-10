/**
 * Management API Types
 */

export interface ApiKey {
  id: string;
  name: string;
  appName: string; // App/organization name for attribution
  keyHash: string; // SHA-256 hash of the actual key
  createdAt: string;
  lastUsedAt?: string;
  permissions: ApiKeyPermission[];
}

export type ApiKeyPermission =
  | 'functions:read'
  | 'functions:write'
  | 'functions:invoke'
  | 'secrets:read'
  | 'secrets:write'
  | 'logs:read'
  | 'admin';

export interface StoredFunction {
  id: string;
  name: string;
  description?: string;
  runtime: 'node' | 'python';
  handler: string;
  code: string; // Base64 encoded
  timeout: number;
  createdAt: string;
  updatedAt: string;
  envVars?: string[]; // Names of secrets to inject as env vars
  createdBy?: string; // API key ID that created this function
  appName?: string; // App name from the API key for attribution
}

export interface StoredSecret {
  name: string;
  encryptedValue: string; // Encrypted with TEE key
  createdAt: string;
  updatedAt: string;
}

export interface CreateFunctionRequest {
  id: string;
  name: string;
  description?: string;
  runtime: 'node' | 'python';
  handler?: string; // Defaults to 'handler'
  code: string; // Base64 encoded source code
  timeout?: number; // Defaults to 30000ms
  envVars?: string[]; // Secret names to inject
}

export interface UpdateFunctionRequest {
  name?: string;
  description?: string;
  code?: string;
  timeout?: number;
  envVars?: string[];
}

export interface CreateSecretRequest {
  name: string;
  value: string;
}

export interface CreateApiKeyRequest {
  name: string;
  appName: string; // App/organization name for attribution
  permissions: ApiKeyPermission[];
}

export interface CreateApiKeyResponse {
  id: string;
  name: string;
  key: string; // Only returned once at creation
  permissions: ApiKeyPermission[];
}

// Client SDK types
export type ClientInitiator = 'fetch' | 'xhr' | 'websocket' | 'beacon' | 'image' | 'script' | 'iframe';

export interface ClientEgressLog {
  timestamp: string;
  method: string;
  url: string;
  host: string;
  path: string;
  initiator: ClientInitiator;
  firstParty: boolean;
  stack?: string;
}

export interface ClientLogsRequest {
  logs: ClientEgressLog[];
}

// App configuration (hybrid approach - apps auto-exist, config is optional)
export interface AppConfig {
  appId: string;
  domain?: string; // For SDK detection
  description?: string;
  sdkDetected?: boolean;
  sdkDetectedAt?: string;
  configuredAt?: string;
}

export interface ConfigureAppRequest {
  domain?: string;
  description?: string;
}

// Application Report types
export interface Destination {
  host: string;
  requestCount: number;
  lastSeen: string;
  methods: string[];
  initiators?: string[]; // For client logs
}

export interface AppReport {
  appId: string;
  appName: string;
  generatedAt: string;

  server: {
    status: 'active' | 'inactive' | 'never';
    lastSeen: string | null;
    attestation: {
      publicKey: string;
      raReportUrl: string | null;
    };
    destinations: Destination[];
    totalRequests: number;
  };

  client: {
    status: 'active' | 'inactive' | 'never';
    lastSeen: string | null;
    sdkDetected: boolean | null;
    sdkDetectedAt: string | null;
    verificationNote: string;
    destinations: Destination[];
    totalRequests: number;
  };
}
