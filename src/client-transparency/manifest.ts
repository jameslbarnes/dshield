/**
 * Client Manifest Generator
 *
 * Generates cryptographically verifiable manifests for client builds.
 * Computes content hashes, captures build metadata, and produces
 * a manifest that can be signed and published.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type {
  ClientManifest,
  ClientFileEntry,
  BuildMetadata,
  ManifestGeneratorConfig,
} from './types.js';

/**
 * MIME type mapping for common file extensions.
 */
const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.ts': 'application/typescript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
};

/**
 * Compute SHA-256 hash of a buffer.
 */
export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute SHA-256 hash of a file.
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return sha256(content);
}

/**
 * Get MIME type for a file extension.
 */
function getMimeType(filePath: string): string | undefined {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext];
}

/**
 * Check if a path matches any of the glob patterns.
 * Supports simple wildcards (* and **).
 */
function matchesPattern(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*');
    if (new RegExp(`^${regex}$`).test(path)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively collect all files in a directory.
 */
function collectFiles(
  dir: string,
  baseDir: string,
  include?: string[],
  exclude?: string[]
): ClientFileEntry[] {
  const entries: ClientFileEntry[] = [];

  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const relativePath = relative(baseDir, fullPath);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Recurse into subdirectories
      entries.push(...collectFiles(fullPath, baseDir, include, exclude));
    } else if (stat.isFile()) {
      // Check include/exclude patterns
      if (include && include.length > 0 && !matchesPattern(relativePath, include)) {
        continue;
      }
      if (exclude && matchesPattern(relativePath, exclude)) {
        continue;
      }

      entries.push({
        path: relativePath,
        hash: hashFile(fullPath),
        size: stat.size,
        mimeType: getMimeType(fullPath),
      });
    }
  }

  return entries;
}

/**
 * Execute a git command and return the output.
 */
function gitCommand(cmd: string, cwd?: string): string | undefined {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Capture build metadata from the current environment.
 */
export function captureBuildMetadata(cwd?: string): BuildMetadata {
  const metadata: BuildMetadata = {
    buildTimestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
  };

  // Try to capture git information
  const gitCommit = gitCommand('rev-parse HEAD', cwd);
  if (gitCommit) {
    metadata.gitCommit = gitCommit;
  }

  const gitBranch = gitCommand('rev-parse --abbrev-ref HEAD', cwd);
  if (gitBranch) {
    metadata.gitBranch = gitBranch;
  }

  const gitTag = gitCommand('describe --tags --exact-match 2>/dev/null', cwd);
  if (gitTag) {
    metadata.gitTag = gitTag;
  }

  const gitStatus = gitCommand('status --porcelain', cwd);
  if (gitStatus !== undefined) {
    metadata.gitClean = gitStatus === '';
  }

  // Detect CI environment
  if (process.env.GITHUB_ACTIONS) {
    metadata.buildEnvironment = 'github-actions';
    metadata.pipelineUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  } else if (process.env.GITLAB_CI) {
    metadata.buildEnvironment = 'gitlab-ci';
    metadata.pipelineUrl = process.env.CI_PIPELINE_URL;
  } else if (process.env.CIRCLECI) {
    metadata.buildEnvironment = 'circleci';
    metadata.pipelineUrl = process.env.CIRCLE_BUILD_URL;
  } else if (process.env.CI) {
    metadata.buildEnvironment = 'ci';
  } else {
    metadata.buildEnvironment = 'local';
  }

  // Try to get package.json version
  try {
    const pkgPath = join(cwd || process.cwd(), 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      metadata.packageVersion = pkg.version;
    }
  } catch {
    // Ignore if no package.json
  }

  return metadata;
}

/**
 * Compute the bundle hash (Merkle root) from file hashes.
 * Files are sorted by path for deterministic ordering.
 */
export function computeBundleHash(files: ClientFileEntry[]): string {
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const concatenated = sortedFiles.map((f) => `${f.path}:${f.hash}`).join('\n');
  return sha256(concatenated);
}

/**
 * Generate a client manifest from a build directory.
 */
export function generateManifest(config: ManifestGeneratorConfig): ClientManifest {
  if (!existsSync(config.buildDir)) {
    throw new Error(`Build directory does not exist: ${config.buildDir}`);
  }

  // Collect all files
  const files = collectFiles(
    config.buildDir,
    config.buildDir,
    config.include,
    config.exclude
  );

  if (files.length === 0) {
    throw new Error(`No files found in build directory: ${config.buildDir}`);
  }

  // Compute bundle hash
  const bundleHash = computeBundleHash(files);

  // Capture build metadata
  const build = captureBuildMetadata(process.cwd());

  // Generate manifest
  const manifest: ClientManifest = {
    version: '1.0',
    manifestId: randomUUID(),
    name: config.name,
    clientType: config.clientType,
    bundleHash,
    files,
    build,
    allowedEgress: config.allowedEgress,
  };

  // Optional fields
  if (config.source) {
    manifest.source = config.source;
  }

  if (config.dshieldFunctions && config.dshieldFunctions.length > 0) {
    manifest.dshieldFunctions = config.dshieldFunctions;
  }

  if (config.customMetadata) {
    manifest.customMetadata = config.customMetadata;
  }

  return manifest;
}

/**
 * Serialize a manifest to a canonical JSON string.
 * Uses deterministic key ordering for consistent hashing.
 */
export function serializeManifest(manifest: ClientManifest): string {
  return JSON.stringify(manifest, Object.keys(manifest).sort(), 2);
}

/**
 * Verify that a manifest matches the files in a directory.
 */
export function verifyManifestAgainstDirectory(
  manifest: ClientManifest,
  buildDir: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const file of manifest.files) {
    const filePath = join(buildDir, file.path);

    if (!existsSync(filePath)) {
      errors.push(`Missing file: ${file.path}`);
      continue;
    }

    const actualHash = hashFile(filePath);
    if (actualHash !== file.hash) {
      errors.push(`Hash mismatch for ${file.path}: expected ${file.hash}, got ${actualHash}`);
    }
  }

  // Check bundle hash
  const expectedBundleHash = computeBundleHash(manifest.files);
  if (expectedBundleHash !== manifest.bundleHash) {
    errors.push(`Bundle hash mismatch: expected ${manifest.bundleHash}, got ${expectedBundleHash}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
