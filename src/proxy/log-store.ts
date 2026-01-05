import type { LogStore, SignedLogEntry } from './types.js';

/**
 * In-memory log store for testing and development.
 * In production, this would be backed by Firestore.
 */
export class InMemoryLogStore implements LogStore {
  private entries: Map<string, SignedLogEntry[]> = new Map();
  private sequences: Map<string, number> = new Map();

  async append(entry: SignedLogEntry): Promise<void> {
    const functionEntries = this.entries.get(entry.functionId) || [];
    functionEntries.push(entry);
    this.entries.set(entry.functionId, functionEntries);
    this.sequences.set(entry.functionId, entry.sequence);
  }

  async getAll(functionId: string): Promise<SignedLogEntry[]> {
    return this.entries.get(functionId) || [];
  }

  async getLatestSequence(functionId: string): Promise<number> {
    return this.sequences.get(functionId) || 0;
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.entries.clear();
    this.sequences.clear();
  }
}

/**
 * Verify log integrity: check signatures and sequence continuity.
 */
export async function verifyLogIntegrity(
  entries: SignedLogEntry[],
  publicKeyPem: string,
  verifySignatureFn: (data: string, sig: string, key: string) => boolean
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  if (entries.length === 0) {
    return { valid: true, errors: [] };
  }

  // Sort by sequence
  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);

  // Check sequence starts at 1
  if (sorted[0].sequence !== 1) {
    errors.push(`Sequence should start at 1, but starts at ${sorted[0].sequence}`);
  }

  // Check each entry
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const expectedSequence = i + 1;

    // Check sequence continuity
    if (entry.sequence !== expectedSequence) {
      errors.push(
        `Sequence gap detected: expected ${expectedSequence}, got ${entry.sequence}`
      );
    }

    // Verify signature
    const { signature, ...entryWithoutSig } = entry;
    const dataToVerify = JSON.stringify(entryWithoutSig);
    const signatureValid = verifySignatureFn(dataToVerify, signature, publicKeyPem);

    if (!signatureValid) {
      errors.push(`Invalid signature for sequence ${entry.sequence}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
