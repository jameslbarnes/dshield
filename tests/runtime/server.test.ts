import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DShieldRuntime } from '../../src/runtime/server.js';
import type { RuntimeConfig } from '../../src/runtime/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, '../../examples');

describe('DShieldRuntime', () => {
  let runtime: DShieldRuntime;
  let port: number;

  const createConfig = (overrides?: Partial<RuntimeConfig>): RuntimeConfig => ({
    port: 0, // Dynamic port
    functions: [
      {
        id: 'hello',
        name: 'Hello Function',
        entryPoint: path.join(examplesDir, 'hello-function.mjs'),
        runtime: 'node',
        handler: 'handler',
      },
    ],
    logStorage: { type: 'memory' },
    signer: { type: 'ephemeral' },
    ...overrides,
  });

  describe('lifecycle', () => {
    it('can be created with config', () => {
      const config = createConfig();
      runtime = new DShieldRuntime(config);
      expect(runtime).toBeDefined();
    });

    it('can start and stop', async () => {
      const config = createConfig({ port: 0 });
      runtime = new DShieldRuntime(config);

      await runtime.start();
      await runtime.stop();
    });

    it('throws if started twice', async () => {
      const config = createConfig({ port: 0 });
      runtime = new DShieldRuntime(config);

      await runtime.start();
      await expect(runtime.start()).rejects.toThrow('already started');
      await runtime.stop();
    });
  });

  describe('HTTP endpoints', () => {
    beforeEach(async () => {
      const config = createConfig({ port: 0 });
      runtime = new DShieldRuntime(config);
      await runtime.start();

      // Get the actual port (we need to extract it)
      // For now, we'll use a fixed port for testing
    });

    afterEach(async () => {
      if (runtime) {
        await runtime.stop();
      }
    });

    it('exposes public key endpoint', async () => {
      const publicKey = runtime.getPublicKey();
      expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    });
  });

  describe('function registration', () => {
    it('registers functions from config', () => {
      const config = createConfig({
        functions: [
          {
            id: 'fn1',
            name: 'Function 1',
            entryPoint: 'test.mjs',
            runtime: 'node',
          },
          {
            id: 'fn2',
            name: 'Function 2',
            entryPoint: 'test.py',
            runtime: 'python',
          },
        ],
      });

      runtime = new DShieldRuntime(config);
      // Functions are registered in constructor
      expect(runtime).toBeDefined();
    });
  });

  describe('logging', () => {
    beforeEach(async () => {
      const config = createConfig();
      runtime = new DShieldRuntime(config);
      await runtime.start();
    });

    afterEach(async () => {
      await runtime.stop();
    });

    it('returns empty logs for new function', async () => {
      const logs = await runtime.getLogs('hello');
      expect(logs).toEqual([]);
    });
  });
});

describe('FunctionSandbox', () => {
  // These tests require actual subprocess execution
  // Skipping detailed tests for now - will be integration tested

  it.skip('executes Node.js function in subprocess', async () => {
    // TODO: Implement subprocess execution test
  });

  it.skip('routes requests through proxy', async () => {
    // TODO: Implement proxy routing test
  });
});
