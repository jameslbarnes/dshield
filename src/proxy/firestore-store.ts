/**
 * Firestore Log Store for D-Shield
 *
 * Production log storage using Google Firestore.
 * Each log entry is stored with its signature for tamper detection.
 */

import type { LogStore, SignedLogEntry } from './types.js';

// Firestore types (we'll use dynamic import to avoid bundling issues)
interface FirestoreDB {
  collection(name: string): FirestoreCollection;
}

interface FirestoreCollection {
  doc(id: string): FirestoreDoc;
  where(field: string, op: string, value: unknown): FirestoreQuery;
  orderBy(field: string, direction?: string): FirestoreQuery;
  get(): Promise<FirestoreQuerySnapshot>;
  add(data: unknown): Promise<{ id: string }>;
}

interface FirestoreDoc {
  get(): Promise<FirestoreDocSnapshot>;
  set(data: unknown): Promise<void>;
  update(data: unknown): Promise<void>;
}

interface FirestoreQuery {
  where(field: string, op: string, value: unknown): FirestoreQuery;
  orderBy(field: string, direction?: string): FirestoreQuery;
  limit(n: number): FirestoreQuery;
  get(): Promise<FirestoreQuerySnapshot>;
}

interface FirestoreQuerySnapshot {
  docs: FirestoreDocSnapshot[];
  empty: boolean;
}

interface FirestoreDocSnapshot {
  exists: boolean;
  data(): unknown;
  id: string;
}

export interface FirestoreConfig {
  projectId: string;
  collection: string;
  credentials?: string; // Path to credentials JSON
}

export class FirestoreLogStore implements LogStore {
  private db: FirestoreDB | null = null;
  private config: FirestoreConfig;
  private collectionName: string;
  private sequenceCache: Map<string, number> = new Map();

  constructor(config: FirestoreConfig) {
    this.config = config;
    this.collectionName = config.collection;
  }

  /**
   * Initialize Firestore connection.
   */
  async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid bundling issues
      // firebase-admin is an optional dependency
      const firebaseAdmin = await import('firebase-admin' as string).catch(() => null);

      if (!firebaseAdmin) {
        throw new Error(
          'firebase-admin is not installed. Run: npm install firebase-admin'
        );
      }

      const app = firebaseAdmin.initializeApp({
        credential: this.config.credentials
          ? firebaseAdmin.credential.cert(this.config.credentials)
          : firebaseAdmin.credential.applicationDefault(),
        projectId: this.config.projectId,
      });

      this.db = firebaseAdmin.firestore(app) as unknown as FirestoreDB;
      console.log(`Firestore initialized: ${this.config.projectId}/${this.collectionName}`);
    } catch (error) {
      console.error('Failed to initialize Firestore:', error);
      throw error;
    }
  }

  /**
   * Append a signed log entry.
   */
  async append(entry: SignedLogEntry): Promise<void> {
    if (!this.db) {
      throw new Error('Firestore not initialized');
    }

    const docId = `${entry.functionId}_${entry.sequence}`;

    await this.db.collection(this.collectionName).doc(docId).set({
      ...entry,
      _createdAt: new Date().toISOString(),
    });

    // Update sequence cache
    this.sequenceCache.set(entry.functionId, entry.sequence);
  }

  /**
   * Get all log entries for a function.
   */
  async getAll(functionId: string): Promise<SignedLogEntry[]> {
    if (!this.db) {
      throw new Error('Firestore not initialized');
    }

    const snapshot = await this.db
      .collection(this.collectionName)
      .where('functionId', '==', functionId)
      .orderBy('sequence', 'asc')
      .get();

    if (snapshot.empty) {
      return [];
    }

    return snapshot.docs.map((doc) => {
      const data = doc.data() as SignedLogEntry & { _createdAt?: string };
      // Remove internal fields
      const { _createdAt, ...entry } = data;
      return entry as SignedLogEntry;
    });
  }

  /**
   * Get the latest sequence number for a function.
   */
  async getLatestSequence(functionId: string): Promise<number> {
    // Check cache first
    const cached = this.sequenceCache.get(functionId);
    if (cached !== undefined) {
      return cached;
    }

    if (!this.db) {
      throw new Error('Firestore not initialized');
    }

    const snapshot = await this.db
      .collection(this.collectionName)
      .where('functionId', '==', functionId)
      .orderBy('sequence', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      this.sequenceCache.set(functionId, 0);
      return 0;
    }

    const latestEntry = snapshot.docs[0].data() as SignedLogEntry;
    this.sequenceCache.set(functionId, latestEntry.sequence);
    return latestEntry.sequence;
  }
}

/**
 * Create a Firestore log store.
 */
export async function createFirestoreStore(
  config: FirestoreConfig
): Promise<FirestoreLogStore> {
  const store = new FirestoreLogStore(config);
  await store.initialize();
  return store;
}
