import { describe, it, expect, beforeEach } from 'vitest';
import { TEESigner, verifySignature } from '../../src/proxy/signer.js';

describe('TEESigner', () => {
  let signer: TEESigner;

  beforeEach(() => {
    signer = new TEESigner();
  });

  describe('key generation', () => {
    it('generates a valid keypair on construction', () => {
      const publicKey = signer.getPublicKey();
      expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(publicKey).toContain('-----END PUBLIC KEY-----');
    });

    it('generates different keys for different instances', () => {
      const signer2 = new TEESigner();
      expect(signer.getPublicKey()).not.toBe(signer2.getPublicKey());
    });

    it('can export and reimport private key', () => {
      const privateKeyPem = signer.exportPrivateKey();
      const signer2 = new TEESigner(privateKeyPem);

      // Same public key means same keypair
      expect(signer2.getPublicKey()).toBe(signer.getPublicKey());
    });
  });

  describe('signing', () => {
    it('produces a non-empty signature', () => {
      const signature = signer.sign('test data');
      expect(signature).toBeTruthy();
      expect(signature.length).toBeGreaterThan(0);
    });

    it('produces consistent signatures for same data', () => {
      const data = 'consistent data';
      const sig1 = signer.sign(data);
      const sig2 = signer.sign(data);
      // RSA signatures are deterministic for same key and data
      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different data', () => {
      const sig1 = signer.sign('data 1');
      const sig2 = signer.sign('data 2');
      expect(sig1).not.toBe(sig2);
    });

    it('handles empty string', () => {
      const signature = signer.sign('');
      expect(signature).toBeTruthy();
    });

    it('handles unicode data', () => {
      const signature = signer.sign('Hello 世界 🌍');
      expect(signature).toBeTruthy();
    });

    it('handles large data', () => {
      const largeData = 'x'.repeat(100000);
      const signature = signer.sign(largeData);
      expect(signature).toBeTruthy();
    });

    it('handles JSON data', () => {
      const jsonData = JSON.stringify({
        sequence: 1,
        timestamp: '2024-01-05T10:00:00Z',
        host: 'api.example.com',
      });
      const signature = signer.sign(jsonData);
      expect(signature).toBeTruthy();
    });
  });
});

describe('verifySignature', () => {
  let signer: TEESigner;

  beforeEach(() => {
    signer = new TEESigner();
  });

  it('verifies valid signature', () => {
    const data = 'test data';
    const signature = signer.sign(data);
    const publicKey = signer.getPublicKey();

    expect(verifySignature(data, signature, publicKey)).toBe(true);
  });

  it('rejects signature with wrong data', () => {
    const signature = signer.sign('original data');
    const publicKey = signer.getPublicKey();

    expect(verifySignature('modified data', signature, publicKey)).toBe(false);
  });

  it('rejects signature with wrong public key', () => {
    const data = 'test data';
    const signature = signer.sign(data);

    const otherSigner = new TEESigner();
    const wrongPublicKey = otherSigner.getPublicKey();

    expect(verifySignature(data, signature, wrongPublicKey)).toBe(false);
  });

  it('rejects corrupted signature', () => {
    const data = 'test data';
    const signature = signer.sign(data);
    const publicKey = signer.getPublicKey();

    // Corrupt the signature
    const corruptedSignature = signature.slice(0, -5) + 'XXXXX';

    expect(verifySignature(data, corruptedSignature, publicKey)).toBe(false);
  });

  it('rejects empty signature', () => {
    const data = 'test data';
    const publicKey = signer.getPublicKey();

    expect(verifySignature(data, '', publicKey)).toBe(false);
  });

  it('handles invalid public key gracefully', () => {
    const data = 'test data';
    const signature = signer.sign(data);

    expect(verifySignature(data, signature, 'invalid-key')).toBe(false);
  });

  it('verifies JSON log entry signatures', () => {
    const entry = {
      sequence: 1,
      functionId: 'fn-123',
      invocationId: 'inv-456',
      timestamp: '2024-01-05T10:00:00Z',
      method: 'POST',
      host: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      protocol: 'https',
    };

    const data = JSON.stringify(entry);
    const signature = signer.sign(data);
    const publicKey = signer.getPublicKey();

    expect(verifySignature(data, signature, publicKey)).toBe(true);

    // Modify the entry and verify signature fails
    const modifiedEntry = { ...entry, host: 'evil.com' };
    const modifiedData = JSON.stringify(modifiedEntry);

    expect(verifySignature(modifiedData, signature, publicKey)).toBe(false);
  });
});
