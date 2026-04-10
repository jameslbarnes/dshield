/**
 * Management Store - Encrypted persistent storage for functions, secrets, and API keys
 *
 * Uses TEE-derived encryption key from Phala dstack SDK.
 * Data is encrypted at rest and only decryptable inside the same TEE.
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ApiKey,
  ApiKeyPermission,
  StoredFunction,
  StoredSecret,
  CreateFunctionRequest,
  UpdateFunctionRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  AppConfig,
  ConfigureAppRequest,
} from './types.js';
import type { SignedLogEntry } from '../proxy/types.js';

// Storage file path - can be configured via environment
const STORAGE_PATH = process.env.AUDITOR_STORAGE_PATH || '/data/auditor-store.enc';

interface PersistedState {
  version: number;
  functions: [string, StoredFunction][];
  secrets: [string, StoredSecret][];
  apiKeys: [string, ApiKey][];
  appConfigs: [string, AppConfig][];
  egressLogs: [string, SignedLogEntry[]][]; // functionId -> logs
}

export class ManagementStore {
  private functions: Map<string, StoredFunction> = new Map();
  private secrets: Map<string, StoredSecret> = new Map();
  private apiKeys: Map<string, ApiKey> = new Map();
  private appConfigs: Map<string, AppConfig> = new Map();
  private egressLogs: Map<string, SignedLogEntry[]> = new Map();
  private encryptionKey: Buffer | null = null;
  private rootApiKey: string | null = null;
  private initialized = false;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Encryption key will be derived in initialize()
  }

  /**
   * Derive encryption key from TEE
   * Falls back to environment-based key for local development
   */
  private async deriveEncryptionKey(): Promise<Buffer> {
    // Check if we're in a TEE environment
    const inTee = existsSync('/var/run/dstack.sock');

    if (inTee) {
      try {
        // Use dstack SDK to derive a deterministic key
        const { TappdClient } = await import('@phala/dstack-sdk');
        const client = new TappdClient();
        const derived = await client.deriveKey('/auditor/storage', 'v1');
        const keyBytes = derived.asUint8Array();
        // Use first 32 bytes for AES-256
        console.log('[Store] Encryption key derived from TEE');
        return Buffer.from(keyBytes.slice(0, 32));
      } catch (err) {
        console.warn('[Store] Failed to derive key from TEE, falling back:', err);
      }
    }

    // Fallback for local development - use env-based key or generate one
    const envKey = process.env.AUDITOR_ENCRYPTION_KEY;
    if (envKey) {
      console.log('[Store] Using encryption key from environment');
      return Buffer.from(createHash('sha256').update(envKey).digest());
    }

    // Last resort - random key (won't persist across restarts!)
    console.warn('[Store] WARNING: Using random encryption key - data will not persist across restarts!');
    return randomBytes(32);
  }

  /**
   * Initialize the store - must be called before use
   * Derives encryption key and loads persisted state
   */
  async initializeAsync(rootKey?: string): Promise<string> {
    if (this.initialized) {
      return this.rootApiKey || '';
    }

    // Derive encryption key from TEE or fallback
    this.encryptionKey = await this.deriveEncryptionKey();

    // Try to load persisted state
    await this.load();

    // Set up root API key
    if (rootKey) {
      // Check if root key already exists with different value
      const existingRoot = this.apiKeys.get('root');
      if (existingRoot) {
        // Verify the provided key matches
        const keyHash = this.hashKey(rootKey);
        if (existingRoot.keyHash !== keyHash) {
          console.warn('[Store] Provided root key does not match persisted root key - using persisted');
          this.rootApiKey = null; // Can't reveal persisted key
        } else {
          this.rootApiKey = rootKey;
        }
      } else {
        // No persisted root key, use provided one
        this.rootApiKey = rootKey;
        const keyHash = this.hashKey(rootKey);
        this.apiKeys.set('root', {
          id: 'root',
          name: 'Root API Key',
          appName: 'Auditor Admin',
          keyHash,
          createdAt: new Date().toISOString(),
          permissions: ['admin'],
        });
        await this.save();
      }
    } else if (!this.apiKeys.has('root')) {
      // Generate a new root key if not provided and not persisted
      const newRootKey = `auditor_${randomBytes(32).toString('hex')}`;
      this.rootApiKey = newRootKey;
      const keyHash = this.hashKey(newRootKey);
      this.apiKeys.set('root', {
        id: 'root',
        name: 'Root API Key',
        appName: 'Auditor Admin',
        keyHash,
        createdAt: new Date().toISOString(),
        permissions: ['admin'],
      });
      await this.save();
    }

    this.initialized = true;
    return this.rootApiKey || '[persisted - check logs on first run]';
  }

  /**
   * Legacy sync initialize - for backwards compatibility
   * Note: Won't have TEE-derived key, use initializeAsync instead
   */
  initialize(rootKey?: string): string {
    if (!this.encryptionKey) {
      // Use fallback key synchronously
      const envKey = process.env.AUDITOR_ENCRYPTION_KEY;
      if (envKey) {
        this.encryptionKey = Buffer.from(createHash('sha256').update(envKey).digest());
      } else {
        console.warn('[Store] WARNING: Using random encryption key in sync mode');
        this.encryptionKey = randomBytes(32);
      }
    }

    if (rootKey) {
      this.rootApiKey = rootKey;
      const keyHash = this.hashKey(rootKey);
      this.apiKeys.set('root', {
        id: 'root',
        name: 'Root API Key',
        appName: 'Auditor Admin',
        keyHash,
        createdAt: new Date().toISOString(),
        permissions: ['admin'],
      });
      return rootKey;
    }

    const newRootKey = `auditor_${randomBytes(32).toString('hex')}`;
    this.rootApiKey = newRootKey;
    const keyHash = this.hashKey(newRootKey);
    this.apiKeys.set('root', {
      id: 'root',
      name: 'Root API Key',
      appName: 'Auditor Admin',
      keyHash,
      createdAt: new Date().toISOString(),
      permissions: ['admin'],
    });
    return newRootKey;
  }

  /**
   * Load state from encrypted file
   */
  private async load(): Promise<void> {
    if (!existsSync(STORAGE_PATH)) {
      console.log('[Store] No persisted state found, starting fresh');
      return;
    }

    try {
      const encrypted = readFileSync(STORAGE_PATH, 'utf8');
      const decrypted = this.decryptData(encrypted);
      const state: PersistedState = JSON.parse(decrypted);

      // Validate version
      if (state.version !== 1) {
        console.warn(`[Store] Unknown state version ${state.version}, starting fresh`);
        return;
      }

      // Restore state
      this.functions = new Map(state.functions);
      this.secrets = new Map(state.secrets);
      this.apiKeys = new Map(state.apiKeys);
      this.appConfigs = new Map(state.appConfigs);
      this.egressLogs = new Map(state.egressLogs || []);

      const totalLogs = Array.from(this.egressLogs.values()).reduce((sum, logs) => sum + logs.length, 0);
      console.log(`[Store] Loaded persisted state: ${this.functions.size} functions, ${this.secrets.size} secrets, ${this.apiKeys.size} API keys, ${totalLogs} log entries`);
    } catch (err) {
      console.error('[Store] Failed to load persisted state:', err);
      console.log('[Store] Starting with fresh state');
    }
  }

  /**
   * Save state to encrypted file (debounced)
   */
  private async save(): Promise<void> {
    // Debounce saves to avoid excessive disk writes
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveImmediate();
    }, 100);
  }

  /**
   * Immediately save state to encrypted file
   */
  private saveImmediate(): void {
    if (!this.encryptionKey) {
      console.warn('[Store] Cannot save - encryption key not initialized');
      return;
    }

    const state: PersistedState = {
      version: 1,
      functions: Array.from(this.functions.entries()),
      secrets: Array.from(this.secrets.entries()),
      apiKeys: Array.from(this.apiKeys.entries()),
      appConfigs: Array.from(this.appConfigs.entries()),
      egressLogs: Array.from(this.egressLogs.entries()),
    };

    try {
      const json = JSON.stringify(state);
      const encrypted = this.encryptData(json);

      // Ensure directory exists
      const dir = dirname(STORAGE_PATH);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(STORAGE_PATH, encrypted, 'utf8');
      console.log('[Store] State persisted to', STORAGE_PATH);
    } catch (err) {
      console.error('[Store] Failed to persist state:', err);
    }
  }

  /**
   * Encrypt data for storage
   */
  private encryptData(plaintext: string): string {
    if (!this.encryptionKey) throw new Error('Encryption key not initialized');
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt data from storage
   */
  private decryptData(encrypted: string): string {
    if (!this.encryptionKey) throw new Error('Encryption key not initialized');
    const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
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
    const key = `auditor_${randomBytes(32).toString('hex')}`;
    const keyHash = this.hashKey(key);

    const apiKey: ApiKey = {
      id,
      name: request.name,
      appName: request.appName,
      keyHash,
      createdAt: new Date().toISOString(),
      permissions: request.permissions,
    };

    this.apiKeys.set(id, apiKey);
    this.save(); // Persist change

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
    const result = this.apiKeys.delete(id);
    if (result) this.save();
    return result;
  }

  // ============ Function Management ============

  createFunction(request: CreateFunctionRequest, apiKey?: ApiKey): StoredFunction {
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
      createdBy: apiKey?.id,
      appName: apiKey?.appName,
    };

    this.functions.set(fn.id, fn);
    this.save(); // Persist change
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
    this.save(); // Persist change
    return updated;
  }

  deleteFunction(id: string): boolean {
    const result = this.functions.delete(id);
    if (result) this.save();
    return result;
  }

  // ============ Secret Management ============

  private encrypt(plaintext: string): string {
    if (!this.encryptionKey) throw new Error('Encryption key not initialized');
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(encrypted: string): string {
    if (!this.encryptionKey) throw new Error('Encryption key not initialized');
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
    this.save(); // Persist change
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
    const result = this.secrets.delete(name);
    if (result) this.save();
    return result;
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

  // ============ App Configuration ============

  /**
   * Get app configuration (returns null if not configured)
   */
  getAppConfig(appId: string): AppConfig | null {
    return this.appConfigs.get(appId) || null;
  }

  /**
   * Configure an app (creates if doesn't exist)
   */
  configureApp(appId: string, request: ConfigureAppRequest): AppConfig {
    const existing = this.appConfigs.get(appId);
    const now = new Date().toISOString();

    const config: AppConfig = {
      appId,
      domain: request.domain || existing?.domain,
      description: request.description || existing?.description,
      sdkDetected: existing?.sdkDetected,
      sdkDetectedAt: existing?.sdkDetectedAt,
      configuredAt: now,
    };

    this.appConfigs.set(appId, config);
    this.save(); // Persist change
    return config;
  }

  /**
   * Update SDK detection status for an app
   */
  updateSdkDetection(appId: string, detected: boolean): void {
    const existing = this.appConfigs.get(appId);
    const now = new Date().toISOString();

    if (existing) {
      existing.sdkDetected = detected;
      existing.sdkDetectedAt = now;
    } else {
      this.appConfigs.set(appId, {
        appId,
        sdkDetected: detected,
        sdkDetectedAt: now,
      });
    }
    this.save(); // Persist change
  }

  /**
   * List all configured apps
   */
  listAppConfigs(): AppConfig[] {
    return Array.from(this.appConfigs.values());
  }

  /**
   * Get all unique app names from functions and API keys
   */
  getAllAppIds(): string[] {
    const appIds = new Set<string>();

    // From functions
    for (const fn of this.functions.values()) {
      if (fn.appName) {
        appIds.add(fn.appName);
      }
    }

    // From API keys
    for (const key of this.apiKeys.values()) {
      if (key.appName && key.appName !== 'Auditor Admin') {
        appIds.add(key.appName);
      }
    }

    // From app configs
    for (const config of this.appConfigs.values()) {
      appIds.add(config.appId);
    }

    return Array.from(appIds);
  }

  // ============ Egress Log Management ============

  /**
   * Append a log entry for a function
   */
  appendLog(entry: SignedLogEntry): void {
    const logs = this.egressLogs.get(entry.functionId) || [];
    logs.push(entry);
    this.egressLogs.set(entry.functionId, logs);
    this.save(); // Persist change
  }

  /**
   * Get all log entries for a function
   */
  getLogs(functionId: string): SignedLogEntry[] {
    return this.egressLogs.get(functionId) || [];
  }

  /**
   * Get the latest sequence number for a function
   */
  getLatestLogSequence(functionId: string): number {
    const logs = this.egressLogs.get(functionId) || [];
    if (logs.length === 0) return 0;
    return logs[logs.length - 1].sequence;
  }

  /**
   * Clear logs for a function (for testing or retention)
   */
  clearLogs(functionId: string): void {
    this.egressLogs.delete(functionId);
    this.save();
  }

  /**
   * Get total log count across all functions
   */
  getTotalLogCount(): number {
    return Array.from(this.egressLogs.values()).reduce((sum, logs) => sum + logs.length, 0);
  }
}

// Singleton instance
export const managementStore = new ManagementStore();
