/**
 * Client Transparency API
 *
 * HTTP API endpoints for manifest registration and verification.
 * Integrates with the D-Shield runtime server.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { manifestRegistry } from './registry.js';
import { verifyClientManifest } from './signer.js';
import type {
  SignedClientManifest,
  RegisterManifestRequest,
  ManifestVerificationResult,
} from './types.js';

/**
 * Parse JSON body from request.
 */
async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk.toString()));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response.
 */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Client Transparency API handler.
 */
export class ClientTransparencyApi {
  /**
   * Handle incoming HTTP request.
   * Returns true if the request was handled, false otherwise.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', `http://localhost`);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // Only handle /api/manifests routes
    if (pathParts[0] !== 'api' || pathParts[1] !== 'manifests') {
      return false;
    }

    try {
      // POST /api/manifests - Register a new manifest
      if (req.method === 'POST' && pathParts.length === 2) {
        return await this.handleRegister(req, res);
      }

      // GET /api/manifests - List all manifests
      if (req.method === 'GET' && pathParts.length === 2) {
        return this.handleList(res);
      }

      // GET /api/manifests/:id - Get manifest by ID
      if (req.method === 'GET' && pathParts.length === 3) {
        return this.handleGetById(pathParts[2], res);
      }

      // DELETE /api/manifests/:id - Delete manifest
      if (req.method === 'DELETE' && pathParts.length === 3) {
        return this.handleDelete(pathParts[2], res);
      }

      // POST /api/manifests/verify - Verify a manifest
      if (req.method === 'POST' && pathParts[2] === 'verify') {
        return await this.handleVerify(req, res);
      }

      // GET /api/manifests/by-hash/:hash - Get by bundle hash
      if (req.method === 'GET' && pathParts[2] === 'by-hash' && pathParts[3]) {
        return this.handleGetByHash(pathParts[3], res);
      }

      // GET /api/manifests/latest/:name - Get latest for client name
      if (req.method === 'GET' && pathParts[2] === 'latest' && pathParts[3]) {
        const name = decodeURIComponent(pathParts[3]);
        return this.handleGetLatest(name, res);
      }

      // GET /api/manifests/chain/:id - Get manifest chain
      if (req.method === 'GET' && pathParts[2] === 'chain' && pathParts[3]) {
        return this.handleGetChain(pathParts[3], res);
      }

      // POST /api/manifests/check-hash - Quick hash verification
      if (req.method === 'POST' && pathParts[2] === 'check-hash') {
        return await this.handleCheckHash(req, res);
      }

      return false;
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Internal server error',
      });
      return true;
    }
  }

  /**
   * Register a new manifest.
   */
  private async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const body = await parseJsonBody<RegisterManifestRequest>(req);

    if (!body.signedManifest) {
      sendJson(res, 400, { error: 'Missing signedManifest in request body' });
      return true;
    }

    const result = manifestRegistry.register(body);

    if (result.success) {
      sendJson(res, 201, result);
    } else {
      sendJson(res, 400, result);
    }

    return true;
  }

  /**
   * List all registered manifests.
   */
  private handleList(res: ServerResponse): boolean {
    const entries = manifestRegistry.listEntries();
    sendJson(res, 200, { manifests: entries });
    return true;
  }

  /**
   * Get manifest by ID.
   */
  private handleGetById(manifestId: string, res: ServerResponse): boolean {
    const manifest = manifestRegistry.getById(manifestId);

    if (!manifest) {
      sendJson(res, 404, { error: `Manifest ${manifestId} not found` });
      return true;
    }

    sendJson(res, 200, manifest);
    return true;
  }

  /**
   * Delete a manifest.
   */
  private handleDelete(manifestId: string, res: ServerResponse): boolean {
    // TODO: Add authentication check

    const deleted = manifestRegistry.delete(manifestId);

    if (!deleted) {
      sendJson(res, 404, { error: `Manifest ${manifestId} not found` });
      return true;
    }

    sendJson(res, 200, { deleted: true, manifestId });
    return true;
  }

  /**
   * Verify a manifest.
   */
  private async handleVerify(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    interface VerifyRequest {
      signedManifest: SignedClientManifest;
      trustedPublicKey?: string;
    }

    const body = await parseJsonBody<VerifyRequest>(req);

    if (!body.signedManifest) {
      sendJson(res, 400, { error: 'Missing signedManifest in request body' });
      return true;
    }

    const result: ManifestVerificationResult = verifyClientManifest(
      body.signedManifest,
      undefined, // No file contents for remote verification
      body.trustedPublicKey
    );

    sendJson(res, 200, result);
    return true;
  }

  /**
   * Get manifest by bundle hash.
   */
  private handleGetByHash(bundleHash: string, res: ServerResponse): boolean {
    const manifest = manifestRegistry.getByBundleHash(bundleHash);

    if (!manifest) {
      sendJson(res, 404, {
        error: 'Bundle hash not registered',
        bundleHash,
        trusted: false,
      });
      return true;
    }

    sendJson(res, 200, {
      trusted: true,
      manifest,
    });
    return true;
  }

  /**
   * Get latest manifest for a client name.
   */
  private handleGetLatest(name: string, res: ServerResponse): boolean {
    const manifest = manifestRegistry.getLatest(name);

    if (!manifest) {
      sendJson(res, 404, {
        error: `No manifest found for client: ${name}`,
        name,
      });
      return true;
    }

    sendJson(res, 200, manifest);
    return true;
  }

  /**
   * Get manifest chain (version history).
   */
  private handleGetChain(manifestId: string, res: ServerResponse): boolean {
    const chain = manifestRegistry.getManifestChain(manifestId);

    if (chain.length === 0) {
      sendJson(res, 404, { error: `Manifest ${manifestId} not found` });
      return true;
    }

    sendJson(res, 200, {
      manifestId,
      chain: chain.map((m) => ({
        manifestId: m.manifest.manifestId,
        name: m.manifest.name,
        bundleHash: m.manifest.bundleHash,
        signedAt: m.signedAt,
        version: m.manifest.build.packageVersion,
      })),
    });
    return true;
  }

  /**
   * Quick hash check - verify if a bundle hash is trusted.
   */
  private async handleCheckHash(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    interface CheckHashRequest {
      bundleHash: string;
      trustedFingerprints?: string[];
    }

    const body = await parseJsonBody<CheckHashRequest>(req);

    if (!body.bundleHash) {
      sendJson(res, 400, { error: 'Missing bundleHash in request body' });
      return true;
    }

    const result = manifestRegistry.verifyBundleHash(
      body.bundleHash,
      body.trustedFingerprints
    );

    const status = result.trusted ? 200 : 404;
    sendJson(res, status, result);
    return true;
  }
}

// Singleton instance
export const clientTransparencyApi = new ClientTransparencyApi();
