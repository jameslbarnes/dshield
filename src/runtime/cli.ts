#!/usr/bin/env node
/**
 * D-Shield Runtime CLI
 *
 * Entry point for starting the D-Shield runtime.
 * Reads configuration from environment variables and config files.
 */

import { createRuntime } from './server.js';
import type { RuntimeConfig, FunctionConfig } from './types.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('D-Shield Runtime v0.1.0');
  console.log('========================');

  // Load configuration
  const config = loadConfig();

  console.log(`Configured ${config.functions.length} function(s)`);

  // Create and start runtime
  const runtime = await createRuntime(config);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    await runtime.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('\nD-Shield runtime started successfully');
  console.log(`Public key for verification:\n${runtime.getPublicKey().slice(0, 100)}...`);
}

function loadConfig(): RuntimeConfig {
  const port = parseInt(process.env.DSHIELD_PORT || '3000', 10);
  const functionsPath = process.env.DSHIELD_FUNCTIONS_PATH || './functions';
  const configPath = process.env.DSHIELD_CONFIG_PATH || './dshield.config.json';

  // Try to load config file
  if (fs.existsSync(configPath)) {
    console.log(`Loading config from ${configPath}`);
    const configFile = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      port: configFile.port || port,
      functions: configFile.functions || [],
      logStorage: configFile.logStorage || { type: 'memory' },
      signer: configFile.signer || { type: 'ephemeral' },
    };
  }

  // Auto-discover functions from directory
  const functions = discoverFunctions(functionsPath);

  return {
    port,
    functions,
    logStorage: {
      type: process.env.FIRESTORE_PROJECT_ID ? 'firestore' : 'memory',
      projectId: process.env.FIRESTORE_PROJECT_ID,
      collection: process.env.FIRESTORE_COLLECTION || 'dshield-logs',
    },
    signer: {
      type: 'ephemeral', // In TEE, this would be 'tee'
    },
  };
}

function discoverFunctions(functionsPath: string): FunctionConfig[] {
  const functions: FunctionConfig[] = [];

  if (!fs.existsSync(functionsPath)) {
    console.log(`Functions directory not found: ${functionsPath}`);
    return functions;
  }

  const entries = fs.readdirSync(functionsPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const name = path.basename(entry.name, ext);

      if (ext === '.mjs' || ext === '.js') {
        functions.push({
          id: name,
          name: name,
          entryPoint: path.join(functionsPath, entry.name),
          runtime: 'node',
          handler: 'handler',
        });
        console.log(`Discovered Node.js function: ${name}`);
      } else if (ext === '.py') {
        functions.push({
          id: name,
          name: name,
          entryPoint: path.join(functionsPath, entry.name),
          runtime: 'python',
          handler: 'handler',
        });
        console.log(`Discovered Python function: ${name}`);
      }
    }
  }

  return functions;
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
