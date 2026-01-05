#!/usr/bin/env node
/**
 * Client Transparency CLI
 *
 * Command-line tool for generating and signing client manifests.
 *
 * Usage:
 *   dshield-sign generate --dir ./dist --name "My App" --type web --egress api.example.com
 *   dshield-sign sign --manifest manifest.json --key private.pem
 *   dshield-sign verify --manifest signed-manifest.json
 *   dshield-sign publish --manifest signed-manifest.json --server https://dshield.example.com
 *   dshield-sign keygen --output keys/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  generateManifest,
  serializeManifest,
  signManifest,
  verifyClientManifest,
  generateSigningKeyPair,
  verifyManifestAgainstDirectory,
} from './index.js';
import type { ClientManifest, SignedClientManifest, ManifestGeneratorConfig } from './types.js';

interface CliArgs {
  command: string;
  options: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    command: args[0] || 'help',
    options: {},
    positional: [],
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];

      if (next && !next.startsWith('--')) {
        result.options[key] = next;
        i++;
      } else {
        result.options[key] = true;
      }
    } else {
      result.positional.push(arg);
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`
D-Shield Client Transparency CLI

Usage: dshield-sign <command> [options]

Commands:
  generate    Generate a manifest from a build directory
  sign        Sign a manifest with a private key
  verify      Verify a signed manifest
  publish     Publish a signed manifest to a D-Shield server
  keygen      Generate a new signing key pair
  help        Show this help message

Generate Options:
  --dir <path>        Build directory to scan (required)
  --name <name>       Client name (required)
  --type <type>       Client type: web, mobile-ios, mobile-android, desktop, cli (required)
  --egress <domains>  Comma-separated list of allowed egress domains (required)
  --output <path>     Output file path (default: manifest.json)
  --include <glob>    Glob patterns to include (comma-separated)
  --exclude <glob>    Glob patterns to exclude (comma-separated)
  --functions <ids>   D-Shield function IDs this client uses (comma-separated)
  --repo <url>        Source repository URL
  --commit <hash>     Source commit hash

Sign Options:
  --manifest <path>   Path to manifest JSON file (required)
  --key <path>        Path to private key PEM file (required)
  --output <path>     Output file path (default: signed-manifest.json)

Verify Options:
  --manifest <path>   Path to signed manifest JSON file (required)
  --dir <path>        Build directory to verify against (optional)
  --key <path>        Trusted public key PEM file (optional)

Publish Options:
  --manifest <path>   Path to signed manifest JSON file (required)
  --server <url>      D-Shield server URL (required)
  --latest            Mark as latest version (default: true)

Keygen Options:
  --output <dir>      Output directory for keys (default: ./)
  --prefix <name>     Key file prefix (default: dshield)

Examples:
  # Generate manifest for a web app build
  dshield-sign generate \\
    --dir ./dist \\
    --name "My Web App v1.0.0" \\
    --type web \\
    --egress api.myapp.com,cdn.myapp.com

  # Sign the manifest
  dshield-sign sign \\
    --manifest manifest.json \\
    --key private.pem

  # Verify a signed manifest
  dshield-sign verify \\
    --manifest signed-manifest.json \\
    --dir ./dist

  # Publish to D-Shield server
  dshield-sign publish \\
    --manifest signed-manifest.json \\
    --server https://dshield.myapp.com

  # Generate new signing keys
  dshield-sign keygen --output ./keys
`);
}

function generateCommand(options: Record<string, string | boolean>): void {
  const dir = options.dir as string;
  const name = options.name as string;
  const type = options.type as string;
  const egress = options.egress as string;
  const output = (options.output as string) || 'manifest.json';

  if (!dir || !name || !type || !egress) {
    console.error('Error: --dir, --name, --type, and --egress are required');
    process.exit(1);
  }

  const validTypes = ['web', 'mobile-ios', 'mobile-android', 'desktop', 'cli'];
  if (!validTypes.includes(type)) {
    console.error(`Error: --type must be one of: ${validTypes.join(', ')}`);
    process.exit(1);
  }

  const config: ManifestGeneratorConfig = {
    name,
    clientType: type as ManifestGeneratorConfig['clientType'],
    buildDir: dir,
    allowedEgress: egress.split(',').map((d) => d.trim()),
  };

  if (options.include) {
    config.include = (options.include as string).split(',').map((p) => p.trim());
  }

  if (options.exclude) {
    config.exclude = (options.exclude as string).split(',').map((p) => p.trim());
  }

  if (options.functions) {
    config.dshieldFunctions = (options.functions as string).split(',').map((f) => f.trim());
  }

  if (options.repo || options.commit) {
    config.source = {
      repositoryUrl: (options.repo as string) || '',
      commitHash: (options.commit as string) || '',
    };
  }

  console.log(`Generating manifest for ${dir}...`);

  try {
    const manifest = generateManifest(config);
    const json = serializeManifest(manifest);

    writeFileSync(output, json);
    console.log(`\nManifest generated successfully!`);
    console.log(`  Output: ${output}`);
    console.log(`  Files: ${manifest.files.length}`);
    console.log(`  Bundle hash: ${manifest.bundleHash}`);
    console.log(`  Manifest ID: ${manifest.manifestId}`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function signCommand(options: Record<string, string | boolean>): void {
  const manifestPath = options.manifest as string;
  const keyPath = options.key as string;
  const output = (options.output as string) || 'signed-manifest.json';

  if (!manifestPath || !keyPath) {
    console.error('Error: --manifest and --key are required');
    process.exit(1);
  }

  if (!existsSync(manifestPath)) {
    console.error(`Error: Manifest file not found: ${manifestPath}`);
    process.exit(1);
  }

  if (!existsSync(keyPath)) {
    console.error(`Error: Key file not found: ${keyPath}`);
    process.exit(1);
  }

  console.log(`Signing manifest ${manifestPath}...`);

  try {
    const manifestJson = readFileSync(manifestPath, 'utf-8');
    const manifest: ClientManifest = JSON.parse(manifestJson);
    const privateKey = readFileSync(keyPath, 'utf-8');

    const signedManifest = signManifest(manifest, privateKey);
    const json = JSON.stringify(signedManifest, null, 2);

    writeFileSync(output, json);
    console.log(`\nManifest signed successfully!`);
    console.log(`  Output: ${output}`);
    console.log(`  Key fingerprint: ${signedManifest.keyFingerprint}`);
    console.log(`  Signed at: ${signedManifest.signedAt}`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function verifyCommand(options: Record<string, string | boolean>): void {
  const manifestPath = options.manifest as string;
  const dir = options.dir as string | undefined;
  const keyPath = options.key as string | undefined;

  if (!manifestPath) {
    console.error('Error: --manifest is required');
    process.exit(1);
  }

  if (!existsSync(manifestPath)) {
    console.error(`Error: Manifest file not found: ${manifestPath}`);
    process.exit(1);
  }

  console.log(`Verifying manifest ${manifestPath}...`);

  try {
    const json = readFileSync(manifestPath, 'utf-8');
    const signedManifest: SignedClientManifest = JSON.parse(json);

    let trustedKey: string | undefined;
    if (keyPath) {
      trustedKey = readFileSync(keyPath, 'utf-8');
    }

    // Verify signature and structure
    const result = verifyClientManifest(signedManifest, undefined, trustedKey);

    console.log(`\nSignature verification: ${result.signatureValid ? '✓ VALID' : '✗ INVALID'}`);
    console.log(`Bundle hash verification: ${result.bundleHashValid ? '✓ VALID' : '✗ INVALID'}`);

    // Verify against directory if provided
    if (dir) {
      console.log(`\nVerifying against directory: ${dir}`);
      const dirResult = verifyManifestAgainstDirectory(signedManifest.manifest, dir);

      if (dirResult.valid) {
        console.log('Directory verification: ✓ ALL FILES MATCH');
      } else {
        console.log('Directory verification: ✗ MISMATCH');
        for (const error of dirResult.errors) {
          console.log(`  - ${error}`);
        }
      }
    }

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    }

    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const warning of result.warnings) {
        console.log(`  - ${warning}`);
      }
    }

    console.log(`\nManifest info:`);
    console.log(`  Name: ${signedManifest.manifest.name}`);
    console.log(`  Type: ${signedManifest.manifest.clientType}`);
    console.log(`  Files: ${signedManifest.manifest.files.length}`);
    console.log(`  Bundle hash: ${signedManifest.manifest.bundleHash}`);
    console.log(`  Allowed egress: ${signedManifest.manifest.allowedEgress.join(', ')}`);
    console.log(`  Signed at: ${signedManifest.signedAt}`);
    console.log(`  Key fingerprint: ${signedManifest.keyFingerprint}`);

    process.exit(result.valid ? 0 : 1);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function publishCommand(options: Record<string, string | boolean>): Promise<void> {
  const manifestPath = options.manifest as string;
  const serverUrl = options.server as string;
  const setLatest = options.latest !== false;

  if (!manifestPath || !serverUrl) {
    console.error('Error: --manifest and --server are required');
    process.exit(1);
  }

  if (!existsSync(manifestPath)) {
    console.error(`Error: Manifest file not found: ${manifestPath}`);
    process.exit(1);
  }

  console.log(`Publishing manifest to ${serverUrl}...`);

  try {
    const json = readFileSync(manifestPath, 'utf-8');
    const signedManifest: SignedClientManifest = JSON.parse(json);

    const response = await fetch(`${serverUrl}/api/manifests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signedManifest,
        setLatest,
      }),
    });

    const result = await response.json() as {
      success: boolean;
      entry?: { manifestId: string; manifestUrl: string; isLatest: boolean };
      error?: string;
    };

    if (result.success && result.entry) {
      console.log(`\nManifest published successfully!`);
      console.log(`  Manifest ID: ${result.entry.manifestId}`);
      console.log(`  URL: ${serverUrl}${result.entry.manifestUrl}`);
      console.log(`  Is latest: ${result.entry.isLatest}`);
    } else {
      console.error(`\nPublish failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function keygenCommand(options: Record<string, string | boolean>): void {
  const outputDir = (options.output as string) || '.';
  const prefix = (options.prefix as string) || 'dshield';

  console.log(`Generating RSA-2048 key pair...`);

  try {
    // Create output directory if needed
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const { privateKey, publicKey } = generateSigningKeyPair();

    const privatePath = join(outputDir, `${prefix}-private.pem`);
    const publicPath = join(outputDir, `${prefix}-public.pem`);

    writeFileSync(privatePath, privateKey);
    writeFileSync(publicPath, publicKey);

    console.log(`\nKeys generated successfully!`);
    console.log(`  Private key: ${privatePath}`);
    console.log(`  Public key: ${publicPath}`);
    console.log(`\n⚠️  Keep the private key secure and never commit it to version control!`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'generate':
      generateCommand(args.options);
      break;
    case 'sign':
      signCommand(args.options);
      break;
    case 'verify':
      verifyCommand(args.options);
      break;
    case 'publish':
      await publishCommand(args.options);
      break;
    case 'keygen':
      keygenCommand(args.options);
      break;
    case 'help':
    default:
      printUsage();
      break;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
