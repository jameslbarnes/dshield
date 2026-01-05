import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { LoggingProxyServer } from '../../src/proxy/proxy-server.js';
import { TEESigner, verifySignature } from '../../src/proxy/signer.js';
import { InMemoryLogStore, verifyLogIntegrity } from '../../src/proxy/log-store.js';
import type { ProxyConfig, SignedLogEntry } from '../../src/proxy/types.js';

describe('LoggingProxyServer', () => {
  let proxy: LoggingProxyServer;
  let logStore: InMemoryLogStore;
  let signer: TEESigner;
  let testServer: http.Server;
  let testServerPort: number;
  let proxyPort: number;

  beforeEach(async () => {
    // Create a test HTTP server to receive proxied requests
    testServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
        })
      );
    });

    await new Promise<void>((resolve) => {
      testServer.listen(0, '127.0.0.1', () => {
        const addr = testServer.address();
        testServerPort = typeof addr === 'object' ? addr!.port : 0;
        resolve();
      });
    });

    // Set up proxy with dynamic port allocation (port 0)
    logStore = new InMemoryLogStore();
    signer = new TEESigner();

    const config: ProxyConfig = {
      listenPort: 0, // Dynamic port allocation
      functionId: 'test-function',
      logStore,
      signer,
    };

    proxy = new LoggingProxyServer(config);
    await proxy.start();
    proxyPort = proxy.getPort(); // Get actual allocated port
    proxy.newInvocation();
  });

  afterEach(async () => {
    await proxy.stop();
    await new Promise<void>((resolve) => {
      testServer.close(() => resolve());
    });
  });

  describe('HTTP proxying', () => {
    it('proxies HTTP GET requests', async () => {
      const response = await makeProxiedRequest({
        method: 'GET',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/test-path',
        proxyPort,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.method).toBe('GET');
      expect(body.url).toBe('/test-path');
    });

    it('proxies HTTP POST requests', async () => {
      const response = await makeProxiedRequest({
        method: 'POST',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/api/data',
        proxyPort,
        body: JSON.stringify({ test: 'data' }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.method).toBe('POST');
    });

    it('preserves request headers', async () => {
      const response = await makeProxiedRequest({
        method: 'GET',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/test',
        proxyPort,
        headers: {
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer token123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.headers['x-custom-header']).toBe('custom-value');
      expect(body.headers['authorization']).toBe('Bearer token123');
    });
  });

  describe('logging', () => {
    it('logs HTTP requests with sequence numbers', async () => {
      await makeProxiedRequest({
        method: 'GET',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/first',
        proxyPort,
      });

      await makeProxiedRequest({
        method: 'POST',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/second',
        proxyPort,
      });

      const entries = await logStore.getAll('test-function');

      expect(entries).toHaveLength(2);
      expect(entries[0].sequence).toBe(1);
      expect(entries[1].sequence).toBe(2);
      expect(entries[0].method).toBe('GET');
      expect(entries[1].method).toBe('POST');
      expect(entries[0].path).toBe('/first');
      expect(entries[1].path).toBe('/second');
    });

    it('logs correct host and port', async () => {
      await makeProxiedRequest({
        method: 'GET',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/test',
        proxyPort,
      });

      const entries = await logStore.getAll('test-function');

      expect(entries[0].host).toBe('127.0.0.1');
      expect(entries[0].port).toBe(testServerPort);
      expect(entries[0].protocol).toBe('http');
    });

    it('includes timestamp in log entries', async () => {
      const before = new Date().toISOString();

      await makeProxiedRequest({
        method: 'GET',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/test',
        proxyPort,
      });

      const after = new Date().toISOString();
      const entries = await logStore.getAll('test-function');

      expect(entries[0].timestamp).toBeDefined();
      expect(entries[0].timestamp >= before).toBe(true);
      expect(entries[0].timestamp <= after).toBe(true);
    });

    it('signs all log entries', async () => {
      await makeProxiedRequest({
        method: 'GET',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/test',
        proxyPort,
      });

      const entries = await logStore.getAll('test-function');

      expect(entries[0].signature).toBeDefined();
      expect(entries[0].signature.length).toBeGreaterThan(0);

      // Verify signature is valid
      const { signature, ...entryWithoutSig } = entries[0];
      const isValid = verifySignature(
        JSON.stringify(entryWithoutSig),
        signature,
        signer.getPublicKey()
      );
      expect(isValid).toBe(true);
    });

    it('produces verifiable log integrity', async () => {
      // Make several requests
      for (let i = 0; i < 5; i++) {
        await makeProxiedRequest({
          method: 'GET',
          hostname: '127.0.0.1',
          port: testServerPort,
          path: `/request-${i}`,
          proxyPort,
        });
      }

      const entries = await logStore.getAll('test-function');
      const result = await verifyLogIntegrity(
        entries,
        signer.getPublicKey(),
        verifySignature
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('invocation tracking', () => {
    it('tracks invocation ID across requests', async () => {
      const invocationId = proxy.newInvocation();

      await makeProxiedRequest({
        method: 'GET',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/test',
        proxyPort,
      });

      const entries = await logStore.getAll('test-function');
      expect(entries[0].invocationId).toBe(invocationId);
    });

    it('can set custom invocation ID', async () => {
      proxy.setInvocationId('custom-invocation-123');

      await makeProxiedRequest({
        method: 'GET',
        hostname: '127.0.0.1',
        port: testServerPort,
        path: '/test',
        proxyPort,
      });

      const entries = await logStore.getAll('test-function');
      expect(entries[0].invocationId).toBe('custom-invocation-123');
    });

    it('generates new invocation ID for each call to newInvocation', () => {
      const id1 = proxy.newInvocation();
      const id2 = proxy.newInvocation();
      const id3 = proxy.newInvocation();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
    });
  });

  describe('concurrent requests', () => {
    it('handles concurrent requests with correct sequence numbers', async () => {
      // Make 10 concurrent requests
      const requests = Array.from({ length: 10 }, (_, i) =>
        makeProxiedRequest({
          method: 'GET',
          hostname: '127.0.0.1',
          port: testServerPort,
          path: `/concurrent-${i}`,
          proxyPort,
        })
      );

      await Promise.all(requests);

      const entries = await logStore.getAll('test-function');

      expect(entries).toHaveLength(10);

      // Verify all sequence numbers are unique and form a complete set 1-10
      const sequences = entries.map((e) => e.sequence).sort((a, b) => a - b);
      expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // Verify log integrity
      const result = await verifyLogIntegrity(
        entries,
        signer.getPublicKey(),
        verifySignature
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('proxy URL', () => {
    it('returns correct proxy URL', () => {
      expect(proxy.getProxyUrl()).toBe(`http://127.0.0.1:${proxy.getPort()}`);
    });

    it('getPort returns actual listening port', () => {
      expect(proxy.getPort()).toBeGreaterThan(0);
      expect(proxy.getPort()).toBeLessThan(65536);
    });
  });
});

// Helper function to make requests through the proxy
async function makeProxiedRequest(options: {
  method: string;
  hostname: string;
  port: number;
  path: string;
  proxyPort: number;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const targetUrl = `http://${options.hostname}:${options.port}${options.path}`;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.proxyPort,
        path: targetUrl,
        method: options.method,
        headers: {
          ...options.headers,
          Host: `${options.hostname}:${options.port}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, body });
        });
      }
    );

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}
