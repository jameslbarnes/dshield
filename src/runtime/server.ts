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
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LoggingProxyServer } from '../proxy/proxy-server.js';
import { TEESigner } from '../proxy/signer.js';
import { InMemoryLogStore } from '../proxy/log-store.js';
import { FunctionSandbox, createSandbox } from './function-sandbox.js';
import { managementApi, managementStore } from '../management/index.js';
import { clientTransparencyApi } from '../client-transparency/index.js';
import type { StoredFunction } from '../management/types.js';
import type {
  RuntimeConfig,
  FunctionConfig,
  FunctionRequest,
  FunctionResult,
  LogStorageConfig,
} from './types.js';
import type { LogStore, Signer, RequestLogEntry, ResponseLogEntry, SignedLogEntry } from '../proxy/types.js';

export class DShieldRuntime {
  private config: RuntimeConfig;
  private httpServer: http.Server;
  private proxyServer: LoggingProxyServer;
  private sandboxes: Map<string, FunctionSandbox> = new Map();
  private logStore: LogStore;
  private signer: Signer;
  private started = false;
  private proxyUrl = '';
  private tempDir: string;
  private sequenceLock: Promise<void> = Promise.resolve();
  private readonly SERVER_FUNCTION_ID = 'dshield-server';

  constructor(config: RuntimeConfig) {
    this.config = config;

    // Set up temp directory for dynamic functions
    this.tempDir = path.join(process.cwd(), '.dshield-functions');
    mkdirSync(this.tempDir, { recursive: true });

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

    // Initialize management store with root API key from env or generate new one
    const rootKey = managementStore.initialize(process.env.DSHIELD_ROOT_KEY);

    // Start proxy server
    await this.proxyServer.start();
    this.proxyUrl = this.proxyServer.getProxyUrl();

    // Update sandbox configs with proxy URL
    for (const fn of this.config.functions) {
      const sandbox = createSandbox(fn, {
        httpProxy: this.proxyUrl,
        httpsProxy: this.proxyUrl,
        workDir: process.cwd(),
      });
      this.sandboxes.set(fn.id, sandbox);
    }

    // Start HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.config.port, () => {
        console.log(`D-Shield runtime listening on port ${this.config.port}`);
        console.log(`Logging proxy on ${this.proxyUrl}`);
        console.log(`Registered functions: ${this.config.functions.map((f) => f.id).join(', ') || '(none)'}`);
        console.log('');
        console.log('========================================');
        console.log('ROOT API KEY (save this, shown only once):');
        console.log(rootKey);
        console.log('========================================');
        console.log('');
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
   * Get source IP from request.
   */
  private getSourceIp(req: http.IncomingMessage): string {
    // Check for forwarded headers (reverse proxy)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return ips.trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * Handle incoming HTTP requests.
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const startTime = Date.now();
    const invocationId = randomUUID();
    const sourceIp = this.getSourceIp(req);
    const clientId = req.headers['x-dshield-client-id'] as string | undefined;

    // Parse request body for logging
    const bodyChunks: Buffer[] = [];
    req.on('data', (chunk) => bodyChunks.push(chunk));
    await new Promise<void>((resolve) => req.on('end', resolve));
    const rawBody = Buffer.concat(bodyChunks).toString();

    // Create a helper to send response with logging
    const sendResponse = async (status: number, body: string, headers: Record<string, string> = {}) => {
      const durationMs = Date.now() - startTime;

      // Log response before sending
      await this.logResponse({
        invocationId,
        requestSeq,
        status,
        body,
        durationMs,
      });

      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(body);
    };

    // Log incoming request
    const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
    const requestSeq = await this.logRequest({
      invocationId,
      method: req.method || 'GET',
      path: url.pathname + url.search,
      sourceIp,
      clientId,
      body: rawBody,
    });

    try {
      // Check for management API routes first
      const handled = await managementApi.handle(req, res);
      if (handled) {
        return;
      }

      // Check for client transparency API routes
      const transparencyHandled = await clientTransparencyApi.handle(req, res);
      if (transparencyHandled) {
        return;
      }

      const pathParts = url.pathname.split('/').filter(Boolean);

      // Route: /invoke/:functionId
      if (pathParts[0] === 'invoke' && pathParts[1]) {
        const functionId = pathParts[1];
        await this.handleInvokeWithLogging(functionId, req, res, url, invocationId, requestSeq, rawBody, startTime);
        return;
      }

      // Route: /health
      if (pathParts[0] === 'health') {
        await sendResponse(200, JSON.stringify({ status: 'healthy', uptime: process.uptime() }));
        return;
      }

      // Route: /logs/:functionId
      if (pathParts[0] === 'logs' && pathParts[1]) {
        await this.handleGetLogs(pathParts[1], res);
        return;
      }

      // Route: /functions (list both static and dynamic functions)
      if (pathParts[0] === 'functions') {
        const staticFns = this.config.functions.map((f) => ({
          id: f.id,
          name: f.name,
          runtime: f.runtime,
        }));
        const dynamicFns = managementStore.listFunctions().map((f) => ({
          id: f.id,
          name: f.name,
          runtime: f.runtime,
        }));
        await sendResponse(200, JSON.stringify({ functions: [...staticFns, ...dynamicFns] }));
        return;
      }

      // Route: /publicKey
      if (pathParts[0] === 'publicKey') {
        const durationMs = Date.now() - startTime;
        const body = this.signer.getPublicKey();
        await this.logResponse({
          invocationId,
          requestSeq,
          status: 200,
          body,
          durationMs,
        });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(body);
        return;
      }

      // Route: /proxy - Client SDK proxy endpoint
      if (pathParts[0] === 'proxy') {
        await this.handleClientProxy(req, res);
        return;
      }

      // 404 for unknown routes
      await sendResponse(404, JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      console.error('Request error:', error);
      const errorBody = JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      });
      await sendResponse(500, errorBody);
    }
  }

  /**
   * Handle function invocation (legacy - kept for compatibility).
   */
  private async handleInvoke(
    functionId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    // Try static sandbox first
    let sandbox: FunctionSandbox | undefined = this.sandboxes.get(functionId);

    // If not found, try to load from dynamic function store
    if (!sandbox) {
      const dynamicSandbox = await this.loadDynamicFunction(functionId);
      if (dynamicSandbox) {
        sandbox = dynamicSandbox;
      }
    }

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
   * Handle function invocation with request/response logging.
   */
  private async handleInvokeWithLogging(
    functionId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    invocationId: string,
    requestSeq: number,
    rawBody: string,
    startTime: number
  ): Promise<void> {
    // Try static sandbox first
    let sandbox: FunctionSandbox | undefined = this.sandboxes.get(functionId);

    // If not found, try to load from dynamic function store
    if (!sandbox) {
      const dynamicSandbox = await this.loadDynamicFunction(functionId);
      if (dynamicSandbox) {
        sandbox = dynamicSandbox;
      }
    }

    if (!sandbox) {
      const errorBody = JSON.stringify({ error: `Function '${functionId}' not found` });
      await this.logResponse({
        invocationId,
        requestSeq,
        status: 404,
        body: errorBody,
        durationMs: Date.now() - startTime,
      });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(errorBody);
      return;
    }

    // Set invocation ID for egress log correlation
    this.proxyServer.setInvocationId(invocationId);

    // Parse request body
    let body: unknown;
    try {
      body = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      body = rawBody;
    }

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

    let status: number;
    let responseBody: string;

    if (result.success && result.response) {
      status = result.response.statusCode;
      responseBody = JSON.stringify(result.response.body);
      Object.assign(responseHeaders, result.response.headers);
    } else {
      status = 500;
      responseBody = JSON.stringify({ error: result.error });
    }

    // Log response
    await this.logResponse({
      invocationId,
      requestSeq,
      status,
      body: responseBody,
      durationMs: Date.now() - startTime,
    });

    res.writeHead(status, responseHeaders);
    res.end(responseBody);
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

  /**
   * Compute SHA-256 hash of data.
   */
  private sha256(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Log an incoming request.
   */
  private async logRequest(params: {
    invocationId: string;
    method: string;
    path: string;
    sourceIp: string;
    clientId?: string;
    body?: string;
  }): Promise<number> {
    let requestSeq = 0;

    this.sequenceLock = this.sequenceLock.then(async () => {
      const sequence = (await this.logStore.getLatestSequence(this.SERVER_FUNCTION_ID)) + 1;
      requestSeq = sequence;

      const requestBody = params.body || '';
      const entry: RequestLogEntry = {
        type: 'request',
        sequence,
        functionId: this.SERVER_FUNCTION_ID,
        invocationId: params.invocationId,
        timestamp: new Date().toISOString(),
        method: params.method,
        path: params.path,
        sourceIp: params.sourceIp,
        clientId: params.clientId,
        requestSize: Buffer.byteLength(requestBody),
        requestHash: this.sha256(requestBody),
      };

      const dataToSign = JSON.stringify(entry);
      const signature = this.signer.sign(dataToSign);

      const signedEntry: SignedLogEntry = {
        ...entry,
        signature,
      };

      await this.logStore.append(signedEntry);

      console.log(
        `[REQ] seq=${sequence} ${params.method} ${params.path} from=${params.sourceIp}${params.clientId ? ` client=${params.clientId}` : ''}`
      );
    });

    await this.sequenceLock;
    return requestSeq;
  }

  /**
   * Log an outgoing response.
   */
  private async logResponse(params: {
    invocationId: string;
    requestSeq: number;
    status: number;
    body: string;
    durationMs: number;
  }): Promise<void> {
    this.sequenceLock = this.sequenceLock.then(async () => {
      const sequence = (await this.logStore.getLatestSequence(this.SERVER_FUNCTION_ID)) + 1;

      const entry: ResponseLogEntry = {
        type: 'response',
        sequence,
        functionId: this.SERVER_FUNCTION_ID,
        invocationId: params.invocationId,
        timestamp: new Date().toISOString(),
        requestSeq: params.requestSeq,
        status: params.status,
        responseSize: Buffer.byteLength(params.body),
        responseHash: this.sha256(params.body),
        durationMs: params.durationMs,
      };

      const dataToSign = JSON.stringify(entry);
      const signature = this.signer.sign(dataToSign);

      const signedEntry: SignedLogEntry = {
        ...entry,
        signature,
      };

      await this.logStore.append(signedEntry);

      console.log(
        `[RES] seq=${sequence} status=${params.status} size=${entry.responseSize} duration=${params.durationMs}ms`
      );
    });

    await this.sequenceLock;
  }

  /**
   * Handle client SDK proxy requests.
   * Routes client requests through D-Shield for logging.
   */
  private async handleClientProxy(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Extract target URL from header
    const targetUrl = req.headers['x-dshield-target-url'] as string;
    const clientId = req.headers['x-dshield-client-id'] as string | undefined;
    const sdkVersion = req.headers['x-dshield-sdk-version'] as string | undefined;

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing X-DShield-Target-URL header' }));
      return;
    }

    // Create invocation ID for log correlation
    const invocationId = this.proxyServer.newInvocation();

    // Parse the target URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid target URL' }));
      return;
    }

    // Read request body
    const body = await this.parseRequestBody(req);
    const bodyStr = body ? JSON.stringify(body) : undefined;

    // Forward request through the logging proxy
    // The proxy will log this request with signatures
    try {
      const proxyHost = '127.0.0.1';
      const proxyPort = this.proxyServer.getPort();

      // Make request through proxy
      const proxyReq = http.request({
        host: proxyHost,
        port: proxyPort,
        method: req.method,
        path: targetUrl,
        headers: {
          ...this.flattenHeaders(req.headers),
          host: parsedUrl.host,
          // Remove D-Shield headers before forwarding
          'x-dshield-target-url': undefined,
          'x-dshield-client-id': undefined,
          'x-dshield-sdk-version': undefined,
        },
      });

      // Handle proxy response
      proxyReq.on('response', (proxyRes) => {
        // Forward response headers
        const responseHeaders: Record<string, string> = {
          'X-DShield-Invocation-Id': invocationId,
          'X-DShield-Proxied': 'true',
        };

        if (proxyRes.headers['content-type']) {
          responseHeaders['Content-Type'] = proxyRes.headers['content-type'] as string;
        }

        res.writeHead(proxyRes.statusCode || 200, responseHeaders);

        // Pipe response body
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[Proxy] Request error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy request failed', details: err.message }));
      });

      // Forward request body
      if (bodyStr) {
        proxyReq.write(bodyStr);
      }
      proxyReq.end();

    } catch (error) {
      console.error('[Proxy] Error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Proxy error',
      }));
    }
  }

  /**
   * Load a dynamic function from the management store.
   */
  private async loadDynamicFunction(functionId: string): Promise<FunctionSandbox | null> {
    const storedFn = managementStore.getFunction(functionId);
    if (!storedFn) {
      return null;
    }

    // Decode and write function code to temp file
    const code = Buffer.from(storedFn.code, 'base64').toString('utf-8');
    const ext = storedFn.runtime === 'node' ? '.mjs' : '.py';
    const fnPath = path.join(this.tempDir, `${functionId}${ext}`);
    writeFileSync(fnPath, code);

    // Get secrets to inject as env vars
    const secretEnv = storedFn.envVars
      ? managementStore.getSecretsAsEnv(storedFn.envVars)
      : {};

    // Create function config
    const fnConfig: FunctionConfig = {
      id: storedFn.id,
      name: storedFn.name,
      entryPoint: fnPath,
      runtime: storedFn.runtime,
      handler: storedFn.handler,
      timeout: storedFn.timeout,
      env: secretEnv,
    };

    // Create and cache sandbox
    const sandbox = createSandbox(fnConfig, {
      httpProxy: this.proxyUrl,
      httpsProxy: this.proxyUrl,
      workDir: this.tempDir,
    });

    this.sandboxes.set(functionId, sandbox);
    return sandbox;
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
