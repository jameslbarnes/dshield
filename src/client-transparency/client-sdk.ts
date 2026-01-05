/**
 * Client-Side Verification SDK
 *
 * A lightweight SDK that can be bundled with client applications
 * to enable self-verification. Users can verify that the client
 * code they're running matches the published manifest.
 *
 * This SDK works in browsers and Node.js environments.
 */

// Browser global type declarations for DOM APIs
// These are only used by WebClientVerifier which runs in browser contexts
declare const document: {
  querySelectorAll(selector: string): NodeListOf<Element>;
};
declare const window: {
  location: { origin: string };
};
interface Element {
  getAttribute(name: string): string | null;
}
interface NodeListOf<T> extends Iterable<T> {}

import type {
  SignedClientManifest,
  ManifestVerificationResult,
  FileVerificationResult,
} from './types.js';

/**
 * Configuration for the client verifier.
 */
export interface ClientVerifierConfig {
  /** D-Shield server URL */
  serverUrl: string;
  /** Trusted public key fingerprints (optional) */
  trustedFingerprints?: string[];
  /** Fetch implementation (defaults to global fetch) */
  fetch?: typeof fetch;
}

/**
 * Self-verification result.
 */
export interface SelfVerificationResult extends ManifestVerificationResult {
  /** The manifest used for verification */
  manifest?: SignedClientManifest;
  /** Whether we could connect to the server */
  serverReachable: boolean;
}

/**
 * Compute SHA-256 hash using Web Crypto API.
 */
async function sha256(data: ArrayBuffer | string): Promise<string> {
  const buffer = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify an RSA-SHA256 signature using Web Crypto API.
 */
async function verifyRsaSignature(
  data: string,
  signatureBase64: string,
  publicKeyPem: string
): Promise<boolean> {
  try {
    // Parse PEM to binary
    const pemHeader = '-----BEGIN PUBLIC KEY-----';
    const pemFooter = '-----END PUBLIC KEY-----';
    const pemContents = publicKeyPem
      .replace(pemHeader, '')
      .replace(pemFooter, '')
      .replace(/\s/g, '');
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    // Import the public key
    const publicKey = await crypto.subtle.importKey(
      'spki',
      binaryDer,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify']
    );

    // Decode signature
    const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));

    // Verify
    const dataBuffer = new TextEncoder().encode(data);
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      dataBuffer
    );
  } catch {
    return false;
  }
}

/**
 * Serialize manifest to canonical JSON for signature verification.
 */
function serializeManifest(manifest: SignedClientManifest['manifest']): string {
  return JSON.stringify(manifest, Object.keys(manifest).sort(), 2);
}

/**
 * Client Verifier SDK.
 *
 * Enables client applications to verify their own integrity
 * against published manifests.
 */
export class ClientVerifier {
  private config: ClientVerifierConfig;
  private fetchFn: typeof fetch;

  constructor(config: ClientVerifierConfig) {
    this.config = config;
    this.fetchFn = config.fetch || globalThis.fetch;
  }

  /**
   * Fetch the manifest for a given bundle hash.
   */
  async getManifestByHash(bundleHash: string): Promise<SignedClientManifest | null> {
    try {
      const response = await this.fetchFn(
        `${this.config.serverUrl}/api/manifests/by-hash/${bundleHash}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { manifest?: SignedClientManifest; trusted?: boolean };
      if (data.manifest) {
        return data.manifest;
      }
      // If the response is the manifest directly (without wrapper)
      if ('signature' in data) {
        return data as unknown as SignedClientManifest;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch the latest manifest for a client name.
   */
  async getLatestManifest(clientName: string): Promise<SignedClientManifest | null> {
    try {
      const response = await this.fetchFn(
        `${this.config.serverUrl}/api/manifests/latest/${encodeURIComponent(clientName)}`
      );

      if (!response.ok) {
        return null;
      }

      return await response.json() as SignedClientManifest;
    } catch {
      return null;
    }
  }

  /**
   * Verify a manifest's signature.
   */
  async verifySignature(
    manifest: SignedClientManifest,
    trustedPublicKey?: string
  ): Promise<boolean> {
    const publicKey = trustedPublicKey || manifest.publicKey;
    const manifestJson = serializeManifest(manifest.manifest);
    return verifyRsaSignature(manifestJson, manifest.signature, publicKey);
  }

  /**
   * Compute the bundle hash from file entries.
   */
  async computeBundleHash(files: { path: string; hash: string }[]): Promise<string> {
    const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const concatenated = sortedFiles.map(f => `${f.path}:${f.hash}`).join('\n');
    return sha256(concatenated);
  }

  /**
   * Verify a file's content against its expected hash.
   */
  async verifyFileContent(expectedHash: string, content: ArrayBuffer | string): Promise<boolean> {
    const actualHash = await sha256(content);
    return actualHash === expectedHash;
  }

  /**
   * Verify a manifest against file contents.
   */
  async verifyManifest(
    manifest: SignedClientManifest,
    fileContents: Map<string, ArrayBuffer | string>
  ): Promise<ManifestVerificationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const fileResults: FileVerificationResult[] = [];

    // Verify signature
    const signatureValid = await this.verifySignature(manifest);
    if (!signatureValid) {
      errors.push('Invalid manifest signature');
    }

    // Check trusted fingerprints
    if (this.config.trustedFingerprints?.length) {
      if (!this.config.trustedFingerprints.includes(manifest.keyFingerprint)) {
        errors.push('Manifest signed by untrusted key');
      }
    }

    // Verify individual files
    for (const file of manifest.manifest.files) {
      const content = fileContents.get(file.path);

      if (!content) {
        warnings.push(`File content not provided: ${file.path}`);
        continue;
      }

      const actualHash = await sha256(content);
      const valid = actualHash === file.hash;

      fileResults.push({
        path: file.path,
        expectedHash: file.hash,
        actualHash,
        valid,
        error: valid ? undefined : 'Hash mismatch',
      });

      if (!valid) {
        errors.push(`Hash mismatch: ${file.path}`);
      }
    }

    // Verify bundle hash
    const computedBundleHash = await this.computeBundleHash(manifest.manifest.files);
    const bundleHashValid = computedBundleHash === manifest.manifest.bundleHash;
    if (!bundleHashValid) {
      errors.push('Bundle hash mismatch');
    }

    return {
      valid: signatureValid && bundleHashValid && errors.length === 0,
      signatureValid,
      bundleHashValid,
      fileResults,
      errors,
      warnings,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Quick check if a bundle hash is trusted.
   */
  async checkBundleHash(bundleHash: string): Promise<{
    trusted: boolean;
    manifest?: SignedClientManifest;
    reason?: string;
  }> {
    try {
      const response = await this.fetchFn(
        `${this.config.serverUrl}/api/manifests/check-hash`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundleHash,
            trustedFingerprints: this.config.trustedFingerprints,
          }),
        }
      );

      const data = await response.json() as {
        trusted?: boolean;
        manifest?: SignedClientManifest;
        reason?: string;
      };
      return {
        trusted: data.trusted || false,
        manifest: data.manifest,
        reason: data.reason,
      };
    } catch (error) {
      return {
        trusted: false,
        reason: `Server unreachable: ${error instanceof Error ? error.message : 'unknown'}`,
      };
    }
  }
}

/**
 * Web Client Self-Verifier
 *
 * Specialized verifier for web applications that can fetch their own
 * scripts and verify them against the manifest.
 */
export class WebClientVerifier extends ClientVerifier {
  /**
   * Fetch and hash all scripts on the current page.
   */
  async getPageScripts(): Promise<Map<string, { hash: string; content: string }>> {
    const scripts = new Map<string, { hash: string; content: string }>();

    // Get all script elements
    const scriptElements = document.querySelectorAll('script[src]');

    for (const script of scriptElements) {
      const src = script.getAttribute('src');
      if (!src) continue;

      try {
        // Fetch the script content
        const response = await fetch(src);
        const content = await response.text();
        const hash = await sha256(content);

        // Normalize the path
        const url = new URL(src, window.location.origin);
        const path = url.pathname.replace(/^\//, '');

        scripts.set(path, { hash, content });
      } catch {
        // Skip scripts that can't be fetched
      }
    }

    return scripts;
  }

  /**
   * Self-verify: Check if current page matches the manifest.
   */
  async selfVerify(clientName: string): Promise<SelfVerificationResult> {
    // Fetch the latest manifest
    const manifest = await this.getLatestManifest(clientName);

    if (!manifest) {
      return {
        valid: false,
        signatureValid: false,
        bundleHashValid: false,
        fileResults: [],
        errors: ['Could not fetch manifest from server'],
        warnings: [],
        verifiedAt: new Date().toISOString(),
        serverReachable: false,
      };
    }

    // Get current page scripts
    const pageScripts = await this.getPageScripts();

    // Build file contents map
    const fileContents = new Map<string, string>();
    for (const [path, { content }] of pageScripts) {
      fileContents.set(path, content);
    }

    // Verify
    const result = await this.verifyManifest(manifest, fileContents);

    return {
      ...result,
      manifest,
      serverReachable: true,
    };
  }

  /**
   * Compute the bundle hash of the current page.
   */
  async computeCurrentBundleHash(): Promise<string> {
    const scripts = await this.getPageScripts();
    const files = Array.from(scripts.entries()).map(([path, { hash }]) => ({
      path,
      hash,
    }));
    return this.computeBundleHash(files);
  }
}

/**
 * Create a verifier instance for the browser environment.
 */
export function createWebVerifier(config: ClientVerifierConfig): WebClientVerifier {
  return new WebClientVerifier(config);
}

/**
 * Create a basic verifier instance.
 */
export function createVerifier(config: ClientVerifierConfig): ClientVerifier {
  return new ClientVerifier(config);
}

// Export sha256 for external use
export { sha256 };
