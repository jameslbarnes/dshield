import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryLogStore, verifyLogIntegrity } from '../../src/proxy/log-store.js';
import { TEESigner, verifySignature } from '../../src/proxy/signer.js';
import type { SignedLogEntry } from '../../src/proxy/types.js';

describe('InMemoryLogStore', () => {
  let store: InMemoryLogStore;

  beforeEach(() => {
    store = new InMemoryLogStore();
  });

  describe('append', () => {
    it('appends entries successfully', async () => {
      const entry: SignedLogEntry = {
        sequence: 1,
        functionId: 'fn-123',
        invocationId: 'inv-456',
        timestamp: '2024-01-05T10:00:00Z',
        method: 'GET',
        host: 'example.com',
        port: 443,
        path: '/api',
        protocol: 'https',
        signature: 'sig-123',
      };

      await store.append(entry);
      const entries = await store.getAll('fn-123');

      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(entry);
    });

    it('maintains separate logs per function', async () => {
      const entry1: SignedLogEntry = {
        sequence: 1,
        functionId: 'fn-1',
        invocationId: 'inv-1',
        timestamp: '2024-01-05T10:00:00Z',
        method: 'GET',
        host: 'example.com',
        port: 443,
        path: '/api',
        protocol: 'https',
        signature: 'sig-1',
      };

      const entry2: SignedLogEntry = {
        sequence: 1,
        functionId: 'fn-2',
        invocationId: 'inv-2',
        timestamp: '2024-01-05T10:00:01Z',
        method: 'POST',
        host: 'other.com',
        port: 443,
        path: '/data',
        protocol: 'https',
        signature: 'sig-2',
      };

      await store.append(entry1);
      await store.append(entry2);

      const fn1Entries = await store.getAll('fn-1');
      const fn2Entries = await store.getAll('fn-2');

      expect(fn1Entries).toHaveLength(1);
      expect(fn2Entries).toHaveLength(1);
      expect(fn1Entries[0].host).toBe('example.com');
      expect(fn2Entries[0].host).toBe('other.com');
    });
  });

  describe('getLatestSequence', () => {
    it('returns 0 for new function', async () => {
      const seq = await store.getLatestSequence('new-function');
      expect(seq).toBe(0);
    });

    it('returns correct sequence after appends', async () => {
      const createEntry = (seq: number): SignedLogEntry => ({
        sequence: seq,
        functionId: 'fn-123',
        invocationId: 'inv-456',
        timestamp: '2024-01-05T10:00:00Z',
        method: 'GET',
        host: 'example.com',
        port: 443,
        path: '/api',
        protocol: 'https',
        signature: `sig-${seq}`,
      });

      await store.append(createEntry(1));
      expect(await store.getLatestSequence('fn-123')).toBe(1);

      await store.append(createEntry(2));
      expect(await store.getLatestSequence('fn-123')).toBe(2);

      await store.append(createEntry(3));
      expect(await store.getLatestSequence('fn-123')).toBe(3);
    });
  });

  describe('getAll', () => {
    it('returns empty array for unknown function', async () => {
      const entries = await store.getAll('unknown');
      expect(entries).toEqual([]);
    });

    it('returns all entries in order', async () => {
      const createEntry = (seq: number): SignedLogEntry => ({
        sequence: seq,
        functionId: 'fn-123',
        invocationId: 'inv-456',
        timestamp: `2024-01-05T10:00:0${seq}Z`,
        method: 'GET',
        host: 'example.com',
        port: 443,
        path: `/api/${seq}`,
        protocol: 'https',
        signature: `sig-${seq}`,
      });

      await store.append(createEntry(1));
      await store.append(createEntry(2));
      await store.append(createEntry(3));

      const entries = await store.getAll('fn-123');

      expect(entries).toHaveLength(3);
      expect(entries[0].sequence).toBe(1);
      expect(entries[1].sequence).toBe(2);
      expect(entries[2].sequence).toBe(3);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      const entry: SignedLogEntry = {
        sequence: 1,
        functionId: 'fn-123',
        invocationId: 'inv-456',
        timestamp: '2024-01-05T10:00:00Z',
        method: 'GET',
        host: 'example.com',
        port: 443,
        path: '/api',
        protocol: 'https',
        signature: 'sig-123',
      };

      await store.append(entry);
      expect(await store.getAll('fn-123')).toHaveLength(1);

      store.clear();

      expect(await store.getAll('fn-123')).toHaveLength(0);
      expect(await store.getLatestSequence('fn-123')).toBe(0);
    });
  });
});

describe('verifyLogIntegrity', () => {
  let signer: TEESigner;
  let publicKey: string;

  beforeEach(() => {
    signer = new TEESigner();
    publicKey = signer.getPublicKey();
  });

  const createSignedEntry = (
    seq: number,
    host: string = 'example.com'
  ): SignedLogEntry => {
    const entry = {
      sequence: seq,
      functionId: 'fn-123',
      invocationId: 'inv-456',
      timestamp: `2024-01-05T10:00:0${seq}Z`,
      method: 'GET',
      host,
      port: 443,
      path: '/api',
      protocol: 'https' as const,
    };

    const signature = signer.sign(JSON.stringify(entry));

    return { ...entry, signature };
  };

  it('validates empty log', async () => {
    const result = await verifyLogIntegrity([], publicKey, verifySignature);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates correct log', async () => {
    const entries = [
      createSignedEntry(1),
      createSignedEntry(2),
      createSignedEntry(3),
    ];

    const result = await verifyLogIntegrity(entries, publicKey, verifySignature);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects sequence gap', async () => {
    const entries = [
      createSignedEntry(1),
      createSignedEntry(2),
      createSignedEntry(4), // Missing 3
    ];

    const result = await verifyLogIntegrity(entries, publicKey, verifySignature);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('gap'))).toBe(true);
  });

  it('detects sequence not starting at 1', async () => {
    const entries = [
      createSignedEntry(2), // Should start at 1
      createSignedEntry(3),
    ];

    const result = await verifyLogIntegrity(entries, publicKey, verifySignature);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('start at 1'))).toBe(true);
  });

  it('detects invalid signature', async () => {
    const entry1 = createSignedEntry(1);
    const entry2 = createSignedEntry(2);

    // Corrupt entry2's signature
    entry2.signature = 'invalid-signature';

    const result = await verifyLogIntegrity(
      [entry1, entry2],
      publicKey,
      verifySignature
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid signature'))).toBe(true);
  });

  it('detects tampered data (modified host)', async () => {
    const entry1 = createSignedEntry(1);
    const entry2 = createSignedEntry(2);

    // Tamper with entry2's host after signing
    entry2.host = 'evil.com';

    const result = await verifyLogIntegrity(
      [entry1, entry2],
      publicKey,
      verifySignature
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid signature'))).toBe(true);
  });

  it('detects wrong public key', async () => {
    const entries = [createSignedEntry(1), createSignedEntry(2)];

    const otherSigner = new TEESigner();
    const wrongPublicKey = otherSigner.getPublicKey();

    const result = await verifyLogIntegrity(entries, wrongPublicKey, verifySignature);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2); // Both entries fail
  });

  it('handles out-of-order entries (sorts by sequence)', async () => {
    const entries = [
      createSignedEntry(3),
      createSignedEntry(1),
      createSignedEntry(2),
    ];

    const result = await verifyLogIntegrity(entries, publicKey, verifySignature);

    expect(result.valid).toBe(true);
  });

  it('reports multiple errors', async () => {
    const entry1 = createSignedEntry(2); // Wrong start
    const entry2 = createSignedEntry(4); // Gap from 2 to 4

    // Also corrupt entry2's signature
    entry2.signature = 'invalid';

    const result = await verifyLogIntegrity(
      [entry1, entry2],
      publicKey,
      verifySignature
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
