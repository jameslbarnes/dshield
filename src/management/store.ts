/**
 * Management Store - In-memory storage for functions, secrets, and API keys
 *
 * In production, this could be backed by encrypted persistent storage.
 * The TEE ensures data confidentiality even with in-memory storage.
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type {
  ApiKey,
  ApiKeyPermission,
  StoredFunction,
  StoredSecret,
  CreateFunctionRequest,
  UpdateFunctionRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from './types.js';

export class ManagementStore {
  private functions: Map<string, StoredFunction> = new Map();
  private secrets: Map<string, StoredSecret> = new Map();
  private apiKeys: Map<string, ApiKey> = new Map();
  private encryptionKey: Buffer;
  private rootApiKey: string | null = null;

  constructor() {
    // Generate a random encryption key for secrets
    // In production, this would be derived from TEE-sealed storage
    this.encryptionKey = randomBytes(32);
  }

  /**
   * Initialize with a root API key from environment
   */
  initialize(rootKey?: string): string {
    if (rootKey) {
      this.rootApiKey = rootKey;
      const keyHash = this.hashKey(rootKey);
      this.apiKeys.set('root', {
        id: 'root',
        name: 'Root API Key',
        keyHash,
        createdAt: new Date().toISOString(),
        permissions: ['admin'],
      });
      return rootKey;
    }

    // Generate a new root key if not provided
    const newRootKey = `dshield_${randomBytes(32).toString('hex')}`;
    this.rootApiKey = newRootKey;
    const keyHash = this.hashKey(newRootKey);
    this.apiKeys.set('root', {
      id: 'root',
      name: 'Root API Key',
      keyHash,
      createdAt: new Date().toISOString(),
      permissions: ['admin'],
    });
    return newRootKey;
  }

  /**
   * Get the root API key (only available at startup)
   */
  getRootApiKey(): string | null {
    return this.rootApiKey;
  }

  // ============ API Key Management ============

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  validateApiKey(key: string): ApiKey | null {
    const keyHash = this.hashKey(key);
    for (const apiKey of this.apiKeys.values()) {
      if (apiKey.keyHash === keyHash) {
        // Update last used timestamp
        apiKey.lastUsedAt = new Date().toISOString();
        return apiKey;
      }
    }
    return null;
  }

  hasPermission(apiKey: ApiKey, permission: ApiKeyPermission): boolean {
    return apiKey.permissions.includes('admin') || apiKey.permissions.includes(permission);
  }

  createApiKey(request: CreateApiKeyRequest): CreateApiKeyResponse {
    const id = randomBytes(8).toString('hex');
    const key = `dshield_${randomBytes(32).toString('hex')}`;
    const keyHash = this.hashKey(key);

    const apiKey: ApiKey = {
      id,
      name: request.name,
      keyHash,
      createdAt: new Date().toISOString(),
      permissions: request.permissions,
    };

    this.apiKeys.set(id, apiKey);

    return {
      id,
      name: request.name,
      key, // Only returned once
      permissions: request.permissions,
    };
  }

  listApiKeys(): Omit<ApiKey, 'keyHash'>[] {
    return Array.from(this.apiKeys.values()).map(({ keyHash, ...rest }) => rest);
  }

  deleteApiKey(id: string): boolean {
    if (id === 'root') {
      return false; // Cannot delete root key
    }
    return this.apiKeys.delete(id);
  }

  // ============ Function Management ============

  createFunction(request: CreateFunctionRequest): StoredFunction {
    const now = new Date().toISOString();
    const fn: StoredFunction = {
      id: request.id,
      name: request.name,
      description: request.description,
      runtime: request.runtime,
      handler: request.handler || 'handler',
      code: request.code,
      timeout: request.timeout || 30000,
      createdAt: now,
      updatedAt: now,
      envVars: request.envVars,
    };

    this.functions.set(fn.id, fn);
    return fn;
  }

  getFunction(id: string): StoredFunction | null {
    return this.functions.get(id) || null;
  }

  listFunctions(): StoredFunction[] {
    return Array.from(this.functions.values());
  }

  updateFunction(id: string, updates: UpdateFunctionRequest): StoredFunction | null {
    const fn = this.functions.get(id);
    if (!fn) return null;

    const updated: StoredFunction = {
      ...fn,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.functions.set(id, updated);
    return updated;
  }

  deleteFunction(id: string): boolean {
    return this.functions.delete(id);
  }

  // ============ Secret Management ============

  private encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(encrypted: string): string {
    const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  setSecret(name: string, value: string): StoredSecret {
    const now = new Date().toISOString();
    const existing = this.secrets.get(name);

    const secret: StoredSecret = {
      name,
      encryptedValue: this.encrypt(value),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.secrets.set(name, secret);
    return { ...secret, encryptedValue: '[ENCRYPTED]' };
  }

  getSecret(name: string): string | null {
    const secret = this.secrets.get(name);
    if (!secret) return null;
    return this.decrypt(secret.encryptedValue);
  }

  listSecrets(): { name: string; createdAt: string; updatedAt: string }[] {
    return Array.from(this.secrets.values()).map(({ name, createdAt, updatedAt }) => ({
      name,
      createdAt,
      updatedAt,
    }));
  }

  deleteSecret(name: string): boolean {
    return this.secrets.delete(name);
  }

  /**
   * Get secrets as environment variables for a function
   */
  getSecretsAsEnv(secretNames: string[]): Record<string, string> {
    const env: Record<string, string> = {};
    for (const name of secretNames) {
      const value = this.getSecret(name);
      if (value) {
        env[name] = value;
      }
    }
    return env;
  }
}

// Singleton instance
export const managementStore = new ManagementStore();
