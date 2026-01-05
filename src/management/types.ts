/**
 * Management API Types
 */

export interface ApiKey {
  id: string;
  name: string;
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
  permissions: ApiKeyPermission[];
}

export interface CreateApiKeyResponse {
  id: string;
  name: string;
  key: string; // Only returned once at creation
  permissions: ApiKeyPermission[];
}
