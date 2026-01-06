/**
 * Client Manifest Registry
 *
 * Stores and retrieves signed client manifests for verification.
 * Provides a discovery mechanism for clients to find their expected manifest.
 */

import type {
  SignedClientManifest,
  ManifestRegistryEntry,
  RegisterManifestRequest,
  RegisterManifestResponse,
} from './types.js';
import { verifyManifestSignature, computeKeyFingerprint } from './signer.js';

/**
 * In-memory manifest registry.
 * In production, this would be backed by persistent storage.
 */
export class ManifestRegistry {
  private manifests: Map<string, SignedClientManifest> = new Map();
  private latestByName: Map<string, string> = new Map(); // name -> manifestId
  private byBundleHash: Map<string, string> = new Map(); // bundleHash -> manifestId
  private chainLinks: Map<string, string> = new Map(); // manifestId -> previousManifestId

  /**
   * Register a signed manifest.
   */
  register(request: RegisterManifestRequest): RegisterManifestResponse {
    const { signedManifest, setLatest = true } = request;

    // Verify signature before accepting
    if (!verifyManifestSignature(signedManifest)) {
      return {
        success: false,
        error: 'Invalid manifest signature',
      };
    }

    const manifestId = signedManifest.manifest.manifestId;
    const bundleHash = signedManifest.manifest.bundleHash;
    const name = signedManifest.manifest.name;

    // Check if already registered
    if (this.manifests.has(manifestId)) {
      return {
        success: false,
        error: `Manifest ${manifestId} already registered`,
      };
    }

    // Store the manifest
    this.manifests.set(manifestId, signedManifest);
    this.byBundleHash.set(bundleHash, manifestId);

    // Track latest version
    const previousManifestId = this.latestByName.get(name);
    if (previousManifestId) {
      this.chainLinks.set(manifestId, previousManifestId);
    }

    if (setLatest) {
      this.latestByName.set(name, manifestId);
    }

    const entry: ManifestRegistryEntry = {
      manifestId,
      name,
      bundleHash,
      registeredAt: new Date().toISOString(),
      keyFingerprint: signedManifest.keyFingerprint,
      manifestUrl: `/api/manifests/${manifestId}`,
      isLatest: setLatest,
      previousManifestId,
    };

    return {
      success: true,
      entry,
    };
  }

  /**
   * Get a manifest by ID.
   */
  getById(manifestId: string): SignedClientManifest | undefined {
    return this.manifests.get(manifestId);
  }

  /**
   * Get a manifest by bundle hash.
   */
  getByBundleHash(bundleHash: string): SignedClientManifest | undefined {
    const manifestId = this.byBundleHash.get(bundleHash);
    return manifestId ? this.manifests.get(manifestId) : undefined;
  }

  /**
   * Get the latest manifest for a client name.
   */
  getLatest(name: string): SignedClientManifest | undefined {
    const manifestId = this.latestByName.get(name);
    return manifestId ? this.manifests.get(manifestId) : undefined;
  }

  /**
   * List all registry entries.
   */
  listEntries(): ManifestRegistryEntry[] {
    const entries: ManifestRegistryEntry[] = [];

    for (const [manifestId, manifest] of this.manifests) {
      const name = manifest.manifest.name;
      const latestId = this.latestByName.get(name);

      entries.push({
        manifestId,
        name,
        bundleHash: manifest.manifest.bundleHash,
        registeredAt: manifest.signedAt,
        keyFingerprint: manifest.keyFingerprint,
        manifestUrl: `/api/manifests/${manifestId}`,
        isLatest: latestId === manifestId,
        previousManifestId: this.chainLinks.get(manifestId),
      });
    }

    return entries;
  }

  /**
   * Get the chain of manifests for a client (upgrade history).
   */
  getManifestChain(manifestId: string): SignedClientManifest[] {
    const chain: SignedClientManifest[] = [];
    let currentId: string | undefined = manifestId;

    while (currentId) {
      const manifest = this.manifests.get(currentId);
      if (manifest) {
        chain.push(manifest);
      }
      currentId = this.chainLinks.get(currentId);
    }

    return chain;
  }

  /**
   * Verify a bundle hash is registered and trusted.
   */
  verifyBundleHash(bundleHash: string, trustedFingerprints?: string[]): {
    trusted: boolean;
    manifest?: SignedClientManifest;
    reason?: string;
  } {
    const manifest = this.getByBundleHash(bundleHash);

    if (!manifest) {
      return {
        trusted: false,
        reason: 'Bundle hash not registered',
      };
    }

    if (trustedFingerprints && trustedFingerprints.length > 0) {
      if (!trustedFingerprints.includes(manifest.keyFingerprint)) {
        return {
          trusted: false,
          manifest,
          reason: 'Manifest signed by untrusted key',
        };
      }
    }

    return {
      trusted: true,
      manifest,
    };
  }

  /**
   * Delete a manifest (admin only).
   */
  delete(manifestId: string): boolean {
    const manifest = this.manifests.get(manifestId);
    if (!manifest) {
      return false;
    }

    const bundleHash = manifest.manifest.bundleHash;
    const name = manifest.manifest.name;

    this.manifests.delete(manifestId);
    this.byBundleHash.delete(bundleHash);

    // Update latest if this was the latest
    if (this.latestByName.get(name) === manifestId) {
      // Find previous in chain
      const previousId = this.chainLinks.get(manifestId);
      if (previousId) {
        this.latestByName.set(name, previousId);
      } else {
        this.latestByName.delete(name);
      }
    }

    this.chainLinks.delete(manifestId);

    return true;
  }

  /**
   * Clear all manifests (for testing).
   */
  clear(): void {
    this.manifests.clear();
    this.latestByName.clear();
    this.byBundleHash.clear();
    this.chainLinks.clear();
  }
}

// Singleton instance
export const manifestRegistry = new ManifestRegistry();
