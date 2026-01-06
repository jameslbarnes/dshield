/**
 * Client Manifest Signing
 *
 * Signs client manifests using RSA keys, compatible with D-Shield's
 * TEE signer infrastructure. Provides both signing and verification.
 */

import { createHash } from 'node:crypto';
import forge from 'node-forge';
import type {
  ClientManifest,
  SignedClientManifest,
  ManifestVerificationResult,
  FileVerificationResult,
} from './types.js';
import { serializeManifest, sha256, computeBundleHash } from './manifest.js';

/**
 * Compute a fingerprint (SHA-256) of a public key.
 */
export function computeKeyFingerprint(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem).digest('hex');
}

/**
 * Sign a client manifest using an RSA private key.
 *
 * @param manifest - The manifest to sign
 * @param privateKeyPem - RSA private key in PEM format
 * @returns Signed manifest with signature and public key
 */
export function signManifest(
  manifest: ClientManifest,
  privateKeyPem: string
): SignedClientManifest {
  // Parse the private key
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

  // Derive public key from private key
  const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  const publicKeyPem = forge.pki.publicKeyToPem(publicKey);

  // Serialize manifest to canonical JSON
  const manifestJson = serializeManifest(manifest);

  // Sign the manifest
  const md = forge.md.sha256.create();
  md.update(manifestJson, 'utf8');
  const signature = forge.util.encode64(privateKey.sign(md));

  return {
    manifest,
    signature,
    signedAt: new Date().toISOString(),
    publicKey: publicKeyPem,
    keyFingerprint: computeKeyFingerprint(publicKeyPem),
  };
}

/**
 * Verify the signature of a signed client manifest.
 *
 * @param signedManifest - The signed manifest to verify
 * @param trustedPublicKey - Optional trusted public key to verify against
 * @returns Whether the signature is valid
 */
export function verifyManifestSignature(
  signedManifest: SignedClientManifest,
  trustedPublicKey?: string
): boolean {
  try {
    // Use trusted key if provided, otherwise use embedded key
    const publicKeyPem = trustedPublicKey || signedManifest.publicKey;
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);

    // Serialize manifest to canonical JSON
    const manifestJson = serializeManifest(signedManifest.manifest);

    // Verify signature
    const md = forge.md.sha256.create();
    md.update(manifestJson, 'utf8');
    const signatureBytes = forge.util.decode64(signedManifest.signature);

    return publicKey.verify(md.digest().bytes(), signatureBytes);
  } catch {
    return false;
  }
}

/**
 * Verify the bundle hash of a manifest.
 */
export function verifyBundleHash(manifest: ClientManifest): boolean {
  const computed = computeBundleHash(manifest.files);
  return computed === manifest.bundleHash;
}

/**
 * Verify a file hash against actual content.
 */
export function verifyFileHash(expectedHash: string, content: Buffer | string): boolean {
  const actualHash = sha256(typeof content === 'string' ? Buffer.from(content) : content);
  return actualHash === expectedHash;
}

/**
 * Comprehensive verification of a signed client manifest.
 *
 * @param signedManifest - The signed manifest to verify
 * @param fileContents - Optional map of file path to content for full verification
 * @param trustedPublicKey - Optional trusted public key
 * @returns Detailed verification result
 */
export function verifyClientManifest(
  signedManifest: SignedClientManifest,
  fileContents?: Map<string, Buffer>,
  trustedPublicKey?: string
): ManifestVerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fileResults: FileVerificationResult[] = [];

  // Verify signature
  const signatureValid = verifyManifestSignature(signedManifest, trustedPublicKey);
  if (!signatureValid) {
    errors.push('Invalid manifest signature');
  }

  // Verify bundle hash
  const bundleHashValid = verifyBundleHash(signedManifest.manifest);
  if (!bundleHashValid) {
    errors.push('Bundle hash does not match file hashes');
  }

  // Verify individual files if content provided
  if (fileContents) {
    for (const file of signedManifest.manifest.files) {
      const content = fileContents.get(file.path);

      if (!content) {
        fileResults.push({
          path: file.path,
          expectedHash: file.hash,
          valid: false,
          error: 'File content not provided',
        });
        warnings.push(`File content not provided for: ${file.path}`);
        continue;
      }

      const actualHash = sha256(content);
      const valid = actualHash === file.hash;

      fileResults.push({
        path: file.path,
        expectedHash: file.hash,
        actualHash,
        valid,
        error: valid ? undefined : 'Hash mismatch',
      });

      if (!valid) {
        errors.push(`Hash mismatch for file: ${file.path}`);
      }
    }
  } else {
    // No file contents provided, add warning
    warnings.push('File contents not provided - only signature and bundle hash verified');
  }

  // Check key fingerprint
  const computedFingerprint = computeKeyFingerprint(signedManifest.publicKey);
  if (computedFingerprint !== signedManifest.keyFingerprint) {
    errors.push('Key fingerprint mismatch');
  }

  return {
    valid: errors.length === 0 && signatureValid && bundleHashValid,
    signatureValid,
    bundleHashValid,
    fileResults,
    errors,
    warnings,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Generate a new RSA key pair for manifest signing.
 *
 * @returns Object with privateKey and publicKey in PEM format
 */
export function generateSigningKeyPair(): { privateKey: string; publicKey: string } {
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  return {
    privateKey: forge.pki.privateKeyToPem(keypair.privateKey),
    publicKey: forge.pki.publicKeyToPem(keypair.publicKey),
  };
}

/**
 * Extract the public key from a private key.
 */
export function extractPublicKey(privateKeyPem: string): string {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  return forge.pki.publicKeyToPem(publicKey);
}
