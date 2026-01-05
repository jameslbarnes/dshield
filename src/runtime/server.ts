/**
 * D-Shield Runtime Server
 *
 * Main entry point that:
 * 1. Starts the logging proxy
 * 2. Loads function configurations
 * 3. Handles incoming HTTP requests
 * 4. Routes to appropriate function sandboxes
 * 5. Returns responses with request logging
 */

import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { LoggingProxyServer } from '../proxy/proxy-server.js';
import { TEESigner } from '../proxy/signer.js';
import { InMemoryLogStore } from '../proxy/log-store.js';
import { FunctionSandbox, createSandbox } from './function-sandbox.js';
import type {
  RuntimeConfig,
  FunctionConfig,
  FunctionRequest,
  FunctionResult,
  LogStorageConfig,
} from './types.js';
import type { LogStore, Signer } from '../proxy/types.js';

export class DShieldRuntime {
  private config: RuntimeConfig;
  private httpServer: http.Server;
  private proxyServer: LoggingProxyServer;
  private sandboxes: Map<string, FunctionSandbox> = new Map();
  private logStore: LogStore;
  private signer: Signer;
  private started = false;

  constructor(config: RuntimeConfig) {
    this.config = config;

    // Initialize log store
    this.logStore = this.createLogStore(config.logStorage);

    // Initialize signer
    this.signer = this.createSigner(config.signer);

    // Initialize proxy server
    this.proxyServer = new LoggingProxyServer({
      listenPort: 0, // Dynamic port
      functionId: 'dshield-runtime',
      logStore: this.logStore,
      signer: this.signer,
    });

    // Initialize HTTP server
    this.httpServer = http.createServer(this.handleRequest.bind(this));

    // Initialize sandboxes for each function
    for (const fn of config.functions) {
      this.registerFunction(fn);
    }
  }

  /**
   * Create log store based on configuration.
   */
  private createLogStore(config: LogStorageConfig): LogStore {
    switch (config.type) {
      case 'memory':
        return new InMemoryLogStore();
      case 'firestore':
        // TODO: Implement Firestore store
        console.warn('Firestore not yet implemented, using in-memory store');
        return new InMemoryLogStore();
      default:
        return new InMemoryLogStore();
    }
  }

  /**
   * Create signer based on configuration.
   */
  private createSigner(config: RuntimeConfig['signer']): Signer {
    // For now, always use ephemeral signer
    // TODO: Implement TEE signer for production
    return new TEESigner();
  }

  /**
   * Register a function with the runtime.
   */
  registerFunction(fn: FunctionConfig): void {
    const sandbox = createSandbox(fn, {
      httpProxy: '', // Will be set when proxy starts
      httpsProxy: '',
      workDir: process.cwd(),
    });

    this.sandboxes.set(fn.id, sandbox);
    console.log(`Registered function: ${fn.id} (${fn.runtime})`);
  }

  /**
   * Start the runtime server.
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Runtime already started');
    }

    // Start proxy server
    await this.proxyServer.start();
    const proxyUrl = this.proxyServer.getProxyUrl();

    // Update sandbox configs with proxy URL
    for (const fn of this.config.functions) {
      const sandbox = createSandbox(fn, {
        httpProxy: proxyUrl,
        httpsProxy: proxyUrl,
        workDir: process.cwd(),
      });
      this.sandboxes.set(fn.id, sandbox);
    }

    // Start HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.config.port, () => {
        console.log(`D-Shield runtime listening on port ${this.config.port}`);
        console.log(`Logging proxy on ${proxyUrl}`);
        console.log(`Registered functions: ${this.config.functions.map((f) => f.id).join(', ')}`);
        resolve();
      });
    });

    this.started = true;
  }

  /**
   * Stop the runtime server.
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await Promise.all([
      new Promise<void>((resolve) => this.httpServer.close(() => resolve())),
      this.proxyServer.stop(),
    ]);

    this.started = false;
    console.log('D-Shield runtime stopped');
  }

  /**
   * Get the port the HTTP server is listening on.
   */
  getPort(): number {
    const addr = this.httpServer.address();
    if (addr && typeof addr === 'object') {
      return addr.port;
    }
    return this.config.port;
  }

  /**
   * Handle incoming HTTP requests.
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Parse URL
      const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
      const pathParts = url.pathname.split('/').filter(Boolean);

      // Route: /invoke/:functionId
      if (pathParts[0] === 'invoke' && pathParts[1]) {
        const functionId = pathParts[1];
        await this.handleInvoke(functionId, req, res, url);
        return;
      }

      // Route: /health
      if (pathParts[0] === 'health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', uptime: process.uptime() }));
        return;
      }

      // Route: /logs/:functionId
      if (pathParts[0] === 'logs' && pathParts[1]) {
        await this.handleGetLogs(pathParts[1], res);
        return;
      }

      // Route: /functions
      if (pathParts[0] === 'functions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            functions: this.config.functions.map((f) => ({
              id: f.id,
              name: f.name,
              runtime: f.runtime,
            })),
          })
        );
        return;
      }

      // Route: /publicKey
      if (pathParts[0] === 'publicKey') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(this.signer.getPublicKey());
        return;
      }

      // 404 for unknown routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      console.error('Request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Internal server error',
        })
      );
    }
  }

  /**
   * Handle function invocation.
   */
  private async handleInvoke(
    functionId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    const sandbox = this.sandboxes.get(functionId);

    if (!sandbox) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Function '${functionId}' not found` }));
      return;
    }

    // Set invocation ID for log correlation
    const invocationId = this.proxyServer.newInvocation();

    // Parse request body
    const body = await this.parseRequestBody(req);

    // Build function request
    const functionRequest: FunctionRequest = {
      id: randomUUID(),
      functionId,
      method: req.method || 'GET',
      path: url.pathname,
      headers: this.flattenHeaders(req.headers),
      body,
      query: Object.fromEntries(url.searchParams),
    };

    // Execute function
    const result = await sandbox.execute(functionRequest);

    // Build response
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-DShield-Invocation-Id': invocationId,
      'X-DShield-Duration-Ms': String(result.durationMs),
    };

    if (result.success && result.response) {
      res.writeHead(result.response.statusCode, {
        ...responseHeaders,
        ...result.response.headers,
      });
      res.end(JSON.stringify(result.response.body));
    } else {
      res.writeHead(500, responseHeaders);
      res.end(JSON.stringify({ error: result.error }));
    }
  }

  /**
   * Handle log retrieval.
   */
  private async handleGetLogs(functionId: string, res: http.ServerResponse): Promise<void> {
    const entries = await this.logStore.getAll(functionId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        functionId,
        count: entries.length,
        entries,
        publicKey: this.signer.getPublicKey(),
      })
    );
  }

  /**
   * Parse request body as JSON.
   */
  private async parseRequestBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve) => {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        if (!body) {
          resolve(undefined);
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body); // Return raw string if not JSON
        }
      });
    });
  }

  /**
   * Flatten headers to simple string record.
   */
  private flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (value) {
        result[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }

    return result;
  }

  /**
   * Get the public key for signature verification.
   */
  getPublicKey(): string {
    return this.signer.getPublicKey();
  }

  /**
   * Get all log entries for a function.
   */
  async getLogs(functionId: string) {
    return this.logStore.getAll(functionId);
  }
}

/**
 * Create and start a D-Shield runtime.
 */
export async function createRuntime(config: RuntimeConfig): Promise<DShieldRuntime> {
  const runtime = new DShieldRuntime(config);
  await runtime.start();
  return runtime;
}
