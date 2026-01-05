/**
 * Management API - REST endpoints for function/secret/key management
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { managementStore } from './store.js';
import type {
  ApiKeyPermission,
  CreateFunctionRequest,
  UpdateFunctionRequest,
  CreateApiKeyRequest,
  CreateSecretRequest,
} from './types.js';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
  permissions: ApiKeyPermission[];
}

/**
 * Parse JSON body from request
 */
async function parseBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/**
 * Management API Router
 */
export class ManagementApi {
  private routes: Route[] = [];

  constructor() {
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // API Keys
    this.routes.push({
      method: 'POST',
      pattern: /^\/api\/keys$/,
      handler: this.createApiKey.bind(this),
      permissions: ['admin'],
    });
    this.routes.push({
      method: 'GET',
      pattern: /^\/api\/keys$/,
      handler: this.listApiKeys.bind(this),
      permissions: ['admin'],
    });
    this.routes.push({
      method: 'DELETE',
      pattern: /^\/api\/keys\/(?<id>[^/]+)$/,
      handler: this.deleteApiKey.bind(this),
      permissions: ['admin'],
    });

    // Functions
    this.routes.push({
      method: 'POST',
      pattern: /^\/api\/functions$/,
      handler: this.createFunction.bind(this),
      permissions: ['functions:write'],
    });
    this.routes.push({
      method: 'GET',
      pattern: /^\/api\/functions$/,
      handler: this.listFunctions.bind(this),
      permissions: ['functions:read'],
    });
    this.routes.push({
      method: 'GET',
      pattern: /^\/api\/functions\/(?<id>[^/]+)$/,
      handler: this.getFunction.bind(this),
      permissions: ['functions:read'],
    });
    this.routes.push({
      method: 'PUT',
      pattern: /^\/api\/functions\/(?<id>[^/]+)$/,
      handler: this.updateFunction.bind(this),
      permissions: ['functions:write'],
    });
    this.routes.push({
      method: 'DELETE',
      pattern: /^\/api\/functions\/(?<id>[^/]+)$/,
      handler: this.deleteFunction.bind(this),
      permissions: ['functions:write'],
    });

    // Secrets
    this.routes.push({
      method: 'POST',
      pattern: /^\/api\/secrets$/,
      handler: this.setSecret.bind(this),
      permissions: ['secrets:write'],
    });
    this.routes.push({
      method: 'GET',
      pattern: /^\/api\/secrets$/,
      handler: this.listSecrets.bind(this),
      permissions: ['secrets:read'],
    });
    this.routes.push({
      method: 'DELETE',
      pattern: /^\/api\/secrets\/(?<name>[^/]+)$/,
      handler: this.deleteSecret.bind(this),
      permissions: ['secrets:write'],
    });
  }

  /**
   * Handle incoming request
   * Returns true if handled, false if not a management API route
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // Check if this is an API route
    if (!path.startsWith('/api/')) {
      return false;
    }

    // Find matching route
    for (const route of this.routes) {
      if (req.method !== route.method) continue;

      const match = path.match(route.pattern);
      if (!match) continue;

      // Authenticate
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        sendError(res, 401, 'Missing or invalid Authorization header');
        return true;
      }

      const apiKey = managementStore.validateApiKey(authHeader.slice(7));
      if (!apiKey) {
        sendError(res, 401, 'Invalid API key');
        return true;
      }

      // Check permissions
      const hasPermission = route.permissions.some((p) =>
        managementStore.hasPermission(apiKey, p)
      );
      if (!hasPermission) {
        sendError(res, 403, 'Insufficient permissions');
        return true;
      }

      // Extract params from regex groups
      const params = match.groups || {};

      try {
        await route.handler(req, res, params);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal error';
        sendError(res, 500, message);
      }

      return true;
    }

    // No matching route
    sendError(res, 404, 'Not found');
    return true;
  }

  // ============ API Key Handlers ============

  private async createApiKey(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await parseBody<CreateApiKeyRequest>(req);

    if (!body.name || !body.permissions?.length) {
      sendError(res, 400, 'name and permissions are required');
      return;
    }

    const result = managementStore.createApiKey(body);
    sendJson(res, 201, result);
  }

  private async listApiKeys(
    _req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const keys = managementStore.listApiKeys();
    sendJson(res, 200, { keys });
  }

  private async deleteApiKey(
    _req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>
  ): Promise<void> {
    const { id } = params;
    const deleted = managementStore.deleteApiKey(id);

    if (!deleted) {
      sendError(res, 404, 'API key not found or cannot be deleted');
      return;
    }

    sendJson(res, 200, { deleted: true });
  }

  // ============ Function Handlers ============

  private async createFunction(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await parseBody<CreateFunctionRequest>(req);

    if (!body.id || !body.name || !body.runtime || !body.code) {
      sendError(res, 400, 'id, name, runtime, and code are required');
      return;
    }

    // Check if function already exists
    if (managementStore.getFunction(body.id)) {
      sendError(res, 409, 'Function already exists');
      return;
    }

    const fn = managementStore.createFunction(body);
    sendJson(res, 201, fn);
  }

  private async listFunctions(
    _req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const functions = managementStore.listFunctions().map((fn) => ({
      ...fn,
      code: undefined, // Don't include code in list
    }));
    sendJson(res, 200, { functions });
  }

  private async getFunction(
    _req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>
  ): Promise<void> {
    const { id } = params;
    const fn = managementStore.getFunction(id);

    if (!fn) {
      sendError(res, 404, 'Function not found');
      return;
    }

    sendJson(res, 200, fn);
  }

  private async updateFunction(
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>
  ): Promise<void> {
    const { id } = params;
    const body = await parseBody<UpdateFunctionRequest>(req);

    const fn = managementStore.updateFunction(id, body);

    if (!fn) {
      sendError(res, 404, 'Function not found');
      return;
    }

    sendJson(res, 200, fn);
  }

  private async deleteFunction(
    _req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>
  ): Promise<void> {
    const { id } = params;
    const deleted = managementStore.deleteFunction(id);

    if (!deleted) {
      sendError(res, 404, 'Function not found');
      return;
    }

    sendJson(res, 200, { deleted: true });
  }

  // ============ Secret Handlers ============

  private async setSecret(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await parseBody<CreateSecretRequest>(req);

    if (!body.name || !body.value) {
      sendError(res, 400, 'name and value are required');
      return;
    }

    // Validate secret name (env var compatible)
    if (!/^[A-Z_][A-Z0-9_]*$/.test(body.name)) {
      sendError(
        res,
        400,
        'Secret name must be uppercase with underscores (e.g., ANTHROPIC_API_KEY)'
      );
      return;
    }

    const secret = managementStore.setSecret(body.name, body.value);
    sendJson(res, 200, secret);
  }

  private async listSecrets(
    _req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const secrets = managementStore.listSecrets();
    sendJson(res, 200, { secrets });
  }

  private async deleteSecret(
    _req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>
  ): Promise<void> {
    const { name } = params;
    const deleted = managementStore.deleteSecret(name);

    if (!deleted) {
      sendError(res, 404, 'Secret not found');
      return;
    }

    sendJson(res, 200, { deleted: true });
  }
}

export const managementApi = new ManagementApi();
