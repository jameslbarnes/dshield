/**
 * Client Code Transparency Types
 *
 * These types define the structure for client-side code transparency,
 * allowing developers to cryptographically prove what code is running
 * on client devices.
 */

/**
 * Individual file entry in a client manifest.
 * Contains the file path and its content hash.
 */
export interface ClientFileEntry {
  /** Relative path from build root (e.g., "dist/main.js") */
  path: string;
  /** SHA-256 hash of file contents */
  hash: string;
  /** File size in bytes */
  size: number;
  /** MIME type if detectable */
  mimeType?: string;
}

/**
 * Build metadata captured at manifest generation time.
 */
export interface BuildMetadata {
  /** Git commit hash if available */
  gitCommit?: string;
  /** Git branch name if available */
  gitBranch?: string;
  /** Git tag if available */
  gitTag?: string;
  /** Whether the git working directory was clean */
  gitClean?: boolean;
  /** Build timestamp (ISO 8601) */
  buildTimestamp: string;
  /** Build environment (e.g., "github-actions", "local") */
  buildEnvironment?: string;
  /** CI/CD pipeline URL if available */
  pipelineUrl?: string;
  /** Node.js version used for build */
  nodeVersion?: string;
  /** Operating system */
  platform?: string;
  /** Package.json version if available */
  packageVersion?: string;
}

/**
 * Source code reference for transparency.
 * Links the build to its source repository.
 */
export interface SourceReference {
  /** Repository URL (e.g., "https://github.com/org/repo") */
  repositoryUrl: string;
  /** Specific commit hash */
  commitHash: string;
  /** Path to source within repository (for monorepos) */
  sourcePath?: string;
  /** Instructions to reproduce the build */
  buildCommand?: string;
}

/**
 * Client manifest containing all information needed to verify a client build.
 * This is the primary artifact that gets signed and published.
 */
export interface ClientManifest {
  /** Manifest format version */
  version: '1.0';
  /** Unique identifier for this manifest */
  manifestId: string;
  /** Human-readable name (e.g., "MyApp Web Client v1.2.3") */
  name: string;
  /** Client type */
  clientType: 'web' | 'mobile-ios' | 'mobile-android' | 'desktop' | 'cli';
  /** SHA-256 hash of all file hashes concatenated (Merkle root) */
  bundleHash: string;
  /** Individual file entries */
  files: ClientFileEntry[];
  /** Build metadata */
  build: BuildMetadata;
  /** Source code reference (optional but recommended) */
  source?: SourceReference;
  /** Egress domains this client is allowed to contact */
  allowedEgress: string[];
  /** Associated D-Shield function IDs this client interacts with */
  dshieldFunctions?: string[];
  /** Custom metadata from developer */
  customMetadata?: Record<string, unknown>;
}

/**
 * Signed client manifest with cryptographic signature.
 */
export interface SignedClientManifest {
  /** The manifest being signed */
  manifest: ClientManifest;
  /** Base64-encoded RSA signature of the manifest JSON */
  signature: string;
  /** Timestamp when signature was created (ISO 8601) */
  signedAt: string;
  /** Public key that can verify this signature (PEM format) */
  publicKey: string;
  /** Key fingerprint (SHA-256 of public key) for quick lookup */
  keyFingerprint: string;
}

/**
 * Verification result from checking a client manifest.
 */
export interface ManifestVerificationResult {
  /** Overall verification status */
  valid: boolean;
  /** Signature is cryptographically valid */
  signatureValid: boolean;
  /** Bundle hash matches computed hash of files */
  bundleHashValid: boolean;
  /** Individual file verification results */
  fileResults: FileVerificationResult[];
  /** Any errors encountered */
  errors: string[];
  /** Warnings (non-fatal issues) */
  warnings: string[];
  /** Verification timestamp */
  verifiedAt: string;
}

/**
 * Individual file verification result.
 */
export interface FileVerificationResult {
  path: string;
  expectedHash: string;
  actualHash?: string;
  valid: boolean;
  error?: string;
}

/**
 * Registry entry for a published client manifest.
 * Stored on the D-Shield server for discovery.
 */
export interface ManifestRegistryEntry {
  /** Manifest ID */
  manifestId: string;
  /** Client name */
  name: string;
  /** Bundle hash (for quick lookup) */
  bundleHash: string;
  /** When the manifest was registered */
  registeredAt: string;
  /** Public key fingerprint */
  keyFingerprint: string;
  /** Download URL for full signed manifest */
  manifestUrl: string;
  /** Whether this is the latest version for this client */
  isLatest: boolean;
  /** Previous manifest ID in the chain (for upgrade verification) */
  previousManifestId?: string;
}

/**
 * Configuration for the manifest generator.
 */
export interface ManifestGeneratorConfig {
  /** Name for the client */
  name: string;
  /** Client type */
  clientType: ClientManifest['clientType'];
  /** Root directory containing build output */
  buildDir: string;
  /** Glob patterns for files to include (default: all files) */
  include?: string[];
  /** Glob patterns for files to exclude */
  exclude?: string[];
  /** Allowed egress domains */
  allowedEgress: string[];
  /** D-Shield function IDs this client uses */
  dshieldFunctions?: string[];
  /** Source reference configuration */
  source?: SourceReference;
  /** Custom metadata to include */
  customMetadata?: Record<string, unknown>;
}

/**
 * Request to register a signed manifest with the server.
 */
export interface RegisterManifestRequest {
  /** The signed manifest to register */
  signedManifest: SignedClientManifest;
  /** Make this the latest version */
  setLatest?: boolean;
}

/**
 * Response from manifest registration.
 */
export interface RegisterManifestResponse {
  /** Whether registration succeeded */
  success: boolean;
  /** Registry entry created */
  entry?: ManifestRegistryEntry;
  /** Error message if failed */
  error?: string;
}
