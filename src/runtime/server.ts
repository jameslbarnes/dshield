/**
 * Auditor Runtime Server
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
import path from 'node:path';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LoggingProxyServer } from '../proxy/proxy-server.js';
import { TEESigner } from '../proxy/signer.js';
import { PersistentLogStore } from '../proxy/log-store.js';
import { FunctionSandbox, createSandbox } from './function-sandbox.js';
import { managementApi, managementStore } from '../management/index.js';
import type {
  StoredFunction,
  ClientLogsRequest,
  ClientEgressLog,
  AppReport,
  Destination,
  ConfigureAppRequest,
} from '../management/types.js';
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
  private proxyUrl = '';
  private tempDir: string;

  constructor(config: RuntimeConfig) {
    this.config = config;

    // Set up temp directory for dynamic functions
    this.tempDir = path.join(process.cwd(), '.auditor-functions');
    mkdirSync(this.tempDir, { recursive: true });

    // Initialize log store
    this.logStore = this.createLogStore(config.logStorage);

    // Initialize signer
    this.signer = this.createSigner(config.signer);

    // Initialize proxy server
    this.proxyServer = new LoggingProxyServer({
      listenPort: 0, // Dynamic port
      functionId: 'auditor-runtime',
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
   * Uses PersistentLogStore which stores logs in TEE-encrypted storage.
   */
  private createLogStore(_config: LogStorageConfig): LogStore {
    // Always use persistent log store backed by encrypted storage
    // Logs survive CVM restarts
    return new PersistentLogStore();
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
    // Uses TEE-derived encryption key for persistent storage
    const rootKey = await managementStore.initializeAsync(process.env.DSHIELD_ROOT_KEY);

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
        console.log(`Auditor runtime listening on port ${this.config.port}`);
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
    console.log('Auditor runtime stopped');
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
   * Set CORS headers on response.
   */
  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  /**
   * Handle incoming HTTP requests.
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const startTime = Date.now();

    // Set CORS headers on all responses
    this.setCorsHeaders(res);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Parse URL
      const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
      const pathParts = url.pathname.split('/').filter(Boolean);

      // Route: POST /api/client-logs/:appId (check before management API)
      if (req.method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'client-logs' && pathParts[2]) {
        await this.handleClientLogs(pathParts[2], req, res);
        return;
      }

      // Route: GET /api/apps - List all apps
      if (req.method === 'GET' && pathParts[0] === 'api' && pathParts[1] === 'apps' && !pathParts[2]) {
        await this.handleListApps(res);
        return;
      }

      // Route: PUT /api/apps/:appId - Configure app
      if (req.method === 'PUT' && pathParts[0] === 'api' && pathParts[1] === 'apps' && pathParts[2]) {
        await this.handleConfigureApp(pathParts[2], req, res);
        return;
      }

      // Route: GET /report/:appId.json - JSON report for AI agents
      if (req.method === 'GET' && pathParts[0] === 'report' && pathParts[1]?.endsWith('.json')) {
        const appId = pathParts[1].replace('.json', '');
        await this.handleJsonReport(appId, res);
        return;
      }

      // Route: POST /api/apps/:appId/check-sdk - Trigger SDK detection
      if (req.method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'apps' && pathParts[2] && pathParts[3] === 'check-sdk') {
        await this.handleCheckSdk(pathParts[2], req, res);
        return;
      }

      // Check for management API routes
      const handled = await managementApi.handle(req, res);
      if (handled) {
        return;
      }

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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ functions: [...staticFns, ...dynamicFns] }));
        return;
      }

      // Route: /publicKey
      if (pathParts[0] === 'publicKey') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(this.signer.getPublicKey());
        return;
      }

      // Route: /sdk/auditor.js - Serve the client SDK
      if (pathParts[0] === 'sdk' && pathParts[1] === 'auditor.js') {
        await this.serveClientSdk(res);
        return;
      }

      // Serve static files for frontend
      await this.serveStatic(url.pathname, res);
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

    // Extract and store egress logs from the response
    if (result.response) {
      const rawResponse = result.response as { _egressLogs?: unknown[]; body?: unknown };
      if (rawResponse._egressLogs && Array.isArray(rawResponse._egressLogs)) {
        await this.processEgressLogs(functionId, rawResponse._egressLogs);
        // Remove internal field from response
        delete rawResponse._egressLogs;
      }
    }

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
   * Process egress logs from function execution.
   * Sign each entry with the TEE key and store in the log store.
   */
  private async processEgressLogs(functionId: string, logs: unknown[]): Promise<void> {
    // Get function to retrieve app name for attribution
    const storedFn = managementStore.getFunction(functionId);
    const appName = storedFn?.appName || 'unknown';

    for (const log of logs) {
      if (typeof log !== 'object' || !log) continue;

      const entry = log as Record<string, unknown>;
      const sequence = (await this.logStore.getLatestSequence(functionId)) + 1;

      // Parse URL for host/port/path
      let host = String(entry.host || 'unknown');
      let port = 443;
      let path = String(entry.path || '/');
      let protocol: 'http' | 'https' = 'https';

      if (entry.url) {
        try {
          const parsedUrl = new URL(String(entry.url));
          host = parsedUrl.hostname;
          port = parsedUrl.port ? parseInt(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80);
          path = parsedUrl.pathname + parsedUrl.search;
          protocol = parsedUrl.protocol === 'https:' ? 'https' : 'http';
        } catch {
          // Use defaults
        }
      }

      // Build the log entry (without signature for signing)
      const logEntry = {
        sequence,
        functionId,
        appName, // Include app name for attribution
        invocationId: String(entry.invocationId || ''),
        timestamp: String(entry.timestamp || new Date().toISOString()),
        method: String(entry.method || 'UNKNOWN'),
        host,
        port,
        path,
        protocol,
        source: 'tee' as const, // Mark as TEE-attested
      };

      // Sign the entry with TEE key
      const dataToSign = JSON.stringify(logEntry);
      const signature = this.signer.sign(dataToSign);

      // Store the signed entry
      await this.logStore.append({
        ...logEntry,
        signature,
      });
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
   * Handle client-reported egress logs.
   * These are self-reported by the client SDK and NOT TEE-attested.
   */
  private async handleClientLogs(
    appId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Validate API key
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }));
      return;
    }

    const apiKey = managementStore.validateApiKey(authHeader.slice(7));
    if (!apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid API key' }));
      return;
    }

    // Check permission - require logs:read (or admin) to submit client logs
    if (!managementStore.hasPermission(apiKey, 'logs:read') &&
        !managementStore.hasPermission(apiKey, 'admin')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Insufficient permissions' }));
      return;
    }

    // Parse request body
    const body = await this.parseRequestBody(req) as ClientLogsRequest;
    if (!body?.logs || !Array.isArray(body.logs)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request: logs array required' }));
      return;
    }

    // Process each client log
    let processed = 0;
    for (const log of body.logs) {
      await this.processClientLog(appId, apiKey.appName, log);
      processed++;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      processed,
      appId,
      source: 'client'
    }));
  }

  /**
   * Process a single client-reported log entry.
   * Client logs are stored without TEE signature but marked as source: 'client'.
   */
  private async processClientLog(
    appId: string,
    appName: string,
    log: ClientEgressLog
  ): Promise<void> {
    // Use appId as the functionId for client logs
    const functionId = `client:${appId}`;
    const sequence = (await this.logStore.getLatestSequence(functionId)) + 1;

    // Parse URL for host/port/path
    let host = log.host || 'unknown';
    let port = 443;
    let path = log.path || '/';
    let protocol: 'http' | 'https' = 'https';

    if (log.url) {
      try {
        const parsedUrl = new URL(log.url);
        host = parsedUrl.hostname;
        port = parsedUrl.port ? parseInt(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80);
        path = parsedUrl.pathname + parsedUrl.search;
        protocol = parsedUrl.protocol === 'https:' ? 'https' : 'http';
      } catch {
        // Use defaults from log
      }
    }

    // Build the log entry
    const logEntry = {
      sequence,
      functionId,
      appName,
      invocationId: '', // Client logs don't have invocation IDs
      timestamp: log.timestamp || new Date().toISOString(),
      method: log.method || 'UNKNOWN',
      host,
      port,
      path,
      protocol,
      source: 'client' as const,
      initiator: log.initiator,
    };

    // Client logs don't get TEE signatures - mark clearly as self-reported
    const signature = `client-reported:${appId}`;

    // Store the entry
    await this.logStore.append({
      ...logEntry,
      signature,
    });
  }

  /**
   * Handle GET /api/apps - List all apps.
   */
  private async handleListApps(res: http.ServerResponse): Promise<void> {
    const appIds = managementStore.getAllAppIds();
    const apps = appIds.map((appId) => {
      const config = managementStore.getAppConfig(appId);
      return {
        appId,
        domain: config?.domain,
        description: config?.description,
        sdkDetected: config?.sdkDetected,
        sdkDetectedAt: config?.sdkDetectedAt,
        configuredAt: config?.configuredAt,
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ apps }));
  }

  /**
   * Handle PUT /api/apps/:appId - Configure an app.
   */
  private async handleConfigureApp(
    appId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Validate API key
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }));
      return;
    }

    const apiKey = managementStore.validateApiKey(authHeader.slice(7));
    if (!apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid API key' }));
      return;
    }

    // Check permission - require admin to configure apps
    if (!managementStore.hasPermission(apiKey, 'admin')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin permission required' }));
      return;
    }

    const body = (await this.parseRequestBody(req)) as ConfigureAppRequest;
    const config = managementStore.configureApp(appId, body || {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config));
  }

  /**
   * Handle GET /report/:appId.json - Generate JSON report for AI agents.
   */
  private async handleJsonReport(appId: string, res: http.ServerResponse): Promise<void> {
    const report = await this.generateReport(appId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report, null, 2));
  }

  /**
   * Generate an application report.
   */
  private async generateReport(appId: string): Promise<AppReport> {
    const now = new Date().toISOString();

    // Get all functions for this app
    const functions = managementStore.listFunctions().filter(
      (f) => f.appName === appId || f.id.startsWith(appId)
    );

    // Get server-side logs (TEE-attested)
    const serverLogs: Array<{
      timestamp: string;
      method: string;
      host: string;
      initiator?: string;
    }> = [];
    for (const fn of functions) {
      const logs = await this.logStore.getAll(fn.id);
      const teeLogs = logs.filter((l) => l.source === 'tee' || !l.source);
      serverLogs.push(...teeLogs);
    }

    // Get client-side logs
    const clientLogs = await this.logStore.getAll(`client:${appId}`);

    // Aggregate destinations
    const serverDestinations = this.aggregateDestinations(serverLogs);
    const clientDestinations = this.aggregateDestinations(clientLogs, true);

    // Determine status and last seen
    const serverLastSeen = serverLogs.length > 0
      ? serverLogs.reduce((latest, log) =>
          log.timestamp > latest ? log.timestamp : latest,
          serverLogs[0].timestamp
        )
      : null;

    const clientLastSeen = clientLogs.length > 0
      ? clientLogs.reduce((latest, log) =>
          log.timestamp > latest ? log.timestamp : latest,
          clientLogs[0].timestamp
        )
      : null;

    // Get app config for SDK detection info
    const appConfig = managementStore.getAppConfig(appId);

    // Determine status based on activity
    const TEN_MINUTES = 10 * 60 * 1000;
    const serverStatus = serverLogs.length === 0
      ? 'never'
      : serverLastSeen && (Date.now() - new Date(serverLastSeen).getTime()) < TEN_MINUTES
        ? 'active'
        : 'inactive';

    const clientStatus = clientLogs.length === 0
      ? 'never'
      : clientLastSeen && (Date.now() - new Date(clientLastSeen).getTime()) < TEN_MINUTES
        ? 'active'
        : 'inactive';

    return {
      appId,
      appName: appId,
      generatedAt: now,
      server: {
        status: serverStatus,
        lastSeen: serverLastSeen,
        attestation: {
          publicKey: this.signer.getPublicKey(),
          raReportUrl: process.env.PHALA_RA_REPORT_URL || null,
        },
        destinations: serverDestinations,
        totalRequests: serverLogs.length,
      },
      client: {
        status: clientStatus,
        lastSeen: clientLastSeen,
        sdkDetected: appConfig?.sdkDetected ?? null,
        sdkDetectedAt: appConfig?.sdkDetectedAt ?? null,
        verificationNote: appConfig?.domain
          ? `Open dev tools on ${appConfig.domain} to verify SDK is active`
          : 'Configure app domain to enable SDK verification',
        destinations: clientDestinations,
        totalRequests: clientLogs.length,
      },
    };
  }

  /**
   * Aggregate logs into destination summaries.
   */
  private aggregateDestinations(
    logs: Array<{ host: string; method: string; timestamp: string; initiator?: string }>,
    includeInitiators = false
  ): Destination[] {
    const destMap = new Map<string, {
      requestCount: number;
      lastSeen: string;
      methods: Set<string>;
      initiators: Set<string>;
    }>();

    for (const log of logs) {
      const existing = destMap.get(log.host);
      if (existing) {
        existing.requestCount++;
        if (log.timestamp > existing.lastSeen) {
          existing.lastSeen = log.timestamp;
        }
        existing.methods.add(log.method);
        if (log.initiator) {
          existing.initiators.add(log.initiator);
        }
      } else {
        destMap.set(log.host, {
          requestCount: 1,
          lastSeen: log.timestamp,
          methods: new Set([log.method]),
          initiators: new Set(log.initiator ? [log.initiator] : []),
        });
      }
    }

    // Convert to array and sort by request count
    const destinations: Destination[] = [];
    for (const [host, data] of destMap) {
      const dest: Destination = {
        host,
        requestCount: data.requestCount,
        lastSeen: data.lastSeen,
        methods: Array.from(data.methods),
      };
      if (includeInitiators && data.initiators.size > 0) {
        dest.initiators = Array.from(data.initiators);
      }
      destinations.push(dest);
    }

    return destinations.sort((a, b) => b.requestCount - a.requestCount);
  }

  /**
   * Handle POST /api/apps/:appId/check-sdk - Trigger SDK detection for an app.
   */
  private async handleCheckSdk(
    appId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Validate API key
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }));
      return;
    }

    const apiKey = managementStore.validateApiKey(authHeader.slice(7));
    if (!apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid API key' }));
      return;
    }

    // Check permission - require admin to trigger SDK check
    if (!managementStore.hasPermission(apiKey, 'admin')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin permission required' }));
      return;
    }

    // Get app config to find domain
    const appConfig = managementStore.getAppConfig(appId);
    if (!appConfig?.domain) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'App domain not configured',
        hint: 'Use PUT /api/apps/:appId to set the domain first',
      }));
      return;
    }

    // Check for SDK on the domain
    const detected = await this.checkSiteForSdk(appConfig.domain);
    managementStore.updateSdkDetection(appId, detected);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      appId,
      domain: appConfig.domain,
      sdkDetected: detected,
      checkedAt: new Date().toISOString(),
    }));
  }

  /**
   * Check a site for the presence of the Auditor SDK.
   * Looks for script tags containing auditor markers.
   */
  private async checkSiteForSdk(domain: string): Promise<boolean> {
    try {
      // Ensure domain starts with https://
      const url = domain.startsWith('http') ? domain : `https://${domain}`;

      // Fetch the site with a timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Auditor-SDK-Check/1.0',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`SDK check failed for ${domain}: HTTP ${response.status}`);
        return false;
      }

      const html = await response.text();

      // Look for Auditor SDK markers in the HTML
      const markers = [
        'auditor-client',
        '@anthropic/auditor-client',
        'window.Auditor',
        'Auditor.init',
        '__auditor_original_fetch',
        // Legacy markers (in case old SDK is still in use)
        'dshield-client',
        'window.DShield',
      ];

      for (const marker of markers) {
        if (html.includes(marker)) {
          console.log(`SDK detected on ${domain}: found marker "${marker}"`);
          return true;
        }
      }

      console.log(`SDK not detected on ${domain}`);
      return false;
    } catch (error) {
      console.warn(`SDK check error for ${domain}:`, error);
      return false;
    }
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
   * Serve static files for the frontend.
   */
  private async serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
    const currentFile = fileURLToPath(import.meta.url);
    const staticDir = path.join(path.dirname(currentFile), '..', '..', 'web');

    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };

    // Normalize path and prevent directory traversal
    let filePath = path.join(staticDir, pathname === '/' ? 'index.html' : pathname);

    // If file doesn't exist, serve index.html for SPA routing
    if (!existsSync(filePath)) {
      filePath = path.join(staticDir, 'index.html');
    }

    // If still doesn't exist, 404
    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read file' }));
    }
  }

  /**
   * Serve the client SDK JavaScript file.
   */
  private async serveClientSdk(res: http.ServerResponse): Promise<void> {
    const currentFile = fileURLToPath(import.meta.url);

    // Try multiple possible locations for the SDK
    const possiblePaths = [
      // Development: src/runtime/server.ts -> packages/client-sdk/dist
      path.join(path.dirname(currentFile), '..', '..', 'packages', 'client-sdk', 'dist', 'index.global.js'),
      // Docker: dist/src/runtime/server.js -> packages/client-sdk/dist
      path.join(path.dirname(currentFile), '..', '..', '..', 'packages', 'client-sdk', 'dist', 'index.global.js'),
    ];

    let sdkPath: string | null = null;
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        sdkPath = p;
        break;
      }
    }

    if (!sdkPath) {
      console.error('SDK not found in any of:', possiblePaths);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'SDK not found. Run npm run build in packages/client-sdk' }));
      return;
    }

    try {
      const content = readFileSync(sdkPath);
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(content);
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read SDK file' }));
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

    // Decode base64-encoded function code
    let code: string;
    try {
      code = Buffer.from(storedFn.code, 'base64').toString('utf8');
    } catch {
      // If not valid base64, assume it's already plain text
      code = storedFn.code;
    }

    // Write function code to temp file
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
 * Create and start an Auditor runtime.
 */
export async function createRuntime(config: RuntimeConfig): Promise<DShieldRuntime> {
  const runtime = new DShieldRuntime(config);
  await runtime.start();
  return runtime;
}
