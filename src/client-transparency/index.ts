/**
 * Client Code Transparency Module
 *
 * Enables developers to cryptographically sign and publish manifests
 * of their client-side code, allowing users to verify that the code
 * running in their browser matches the published source.
 *
 * Key components:
 * - Manifest generation from build output
 * - RSA signing compatible with D-Shield TEE keys
 * - Server-side registry for manifest discovery
 * - Client-side SDK for self-verification
 */

// Types
export type {
  ClientManifest,
  SignedClientManifest,
  ClientFileEntry,
  BuildMetadata,
  SourceReference,
  ManifestVerificationResult,
  FileVerificationResult,
  ManifestRegistryEntry,
  ManifestGeneratorConfig,
  RegisterManifestRequest,
  RegisterManifestResponse,
  // SDK verification (recommended)
  SDKVerification,
  // API Surface types (optional - for documentation)
  ApiSurface,
  ApiEndpoint,
  HttpMethod,
  DataFlowDescription,
  DataCategory,
  ThirdPartyIntegration,
  WebSocketEndpoint,
  LocalStorageUsage,
  CookieUsage,
} from './types.js';

// Manifest generation
export {
  generateManifest,
  serializeManifest,
  captureBuildMetadata,
  computeBundleHash,
  verifyManifestAgainstDirectory,
  detectDShieldSDK,
  sha256,
  hashFile,
} from './manifest.js';

// Signing
export {
  signManifest,
  verifyManifestSignature,
  verifyClientManifest,
  verifyBundleHash,
  verifyFileHash,
  generateSigningKeyPair,
  extractPublicKey,
  computeKeyFingerprint,
} from './signer.js';

// Registry
export { ManifestRegistry, manifestRegistry } from './registry.js';

// API
export { ClientTransparencyApi, clientTransparencyApi } from './api.js';

// Client SDK
export {
  ClientVerifier,
  WebClientVerifier,
  createVerifier,
  createWebVerifier,
  type ClientVerifierConfig,
  type SelfVerificationResult,
} from './client-sdk.js';

// API Surface Analyzer (optional - for documentation purposes)
export {
  analyzeApiSurface,
  formatAnalysisReport,
  generateApiSurfaceTemplate,
  type DiscoveredApiCall,
  type AnalysisResult,
} from './api-analyzer.js';

// Transparent Client SDK (recommended approach)
export {
  initDShield,
  createDShieldFetch,
  getSDKInfo,
  isInitialized,
  SDK_VERSION,
  SDK_ID,
  type DShieldConfig,
} from './transparent-sdk.js';
