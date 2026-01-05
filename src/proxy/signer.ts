import forge from 'node-forge';
import type { Signer } from './types.js';

/**
 * TEE-based signer using RSA keys.
 * In production, the private key never leaves the TEE enclave.
 * For testing, we generate ephemeral keys.
 */
export class TEESigner implements Signer {
  private privateKey: forge.pki.rsa.PrivateKey;
  private publicKey: forge.pki.rsa.PublicKey;
  private publicKeyPem: string;

  constructor(privateKeyPem?: string) {
    if (privateKeyPem) {
      this.privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
      this.publicKey = forge.pki.setRsaPublicKey(this.privateKey.n, this.privateKey.e);
    } else {
      // Generate new keypair (for testing or first-time setup)
      const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      this.privateKey = keypair.privateKey;
      this.publicKey = keypair.publicKey;
    }
    this.publicKeyPem = forge.pki.publicKeyToPem(this.publicKey);
  }

  /**
   * Sign data using SHA-256 with RSA.
   * Returns base64-encoded signature.
   */
  sign(data: string): string {
    const md = forge.md.sha256.create();
    md.update(data, 'utf8');
    const signature = this.privateKey.sign(md);
    return forge.util.encode64(signature);
  }

  /**
   * Get the public key in PEM format.
   * This is included in attestation so verifiers can check signatures.
   */
  getPublicKey(): string {
    return this.publicKeyPem;
  }

  /**
   * Export private key (only for backup/migration within TEE).
   * NEVER expose this outside the enclave.
   */
  exportPrivateKey(): string {
    return forge.pki.privateKeyToPem(this.privateKey);
  }
}

/**
 * Verify a signature against data and public key.
 * Used by external verifiers to validate log entries.
 */
export function verifySignature(
  data: string,
  signature: string,
  publicKeyPem: string
): boolean {
  try {
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
    const md = forge.md.sha256.create();
    md.update(data, 'utf8');
    const signatureBytes = forge.util.decode64(signature);
    return publicKey.verify(md.digest().bytes(), signatureBytes);
  } catch {
    return false;
  }
}
