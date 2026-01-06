import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import type {
  EgressLogEntry,
  SignedLogEntry,
  LogStore,
  Signer,
  ProxyConfig,
} from './types.js';

/**
 * HTTP/HTTPS logging proxy server.
 * All outbound requests from user functions route through this proxy.
 * Every request is logged with a sequence number and signed.
 */
export class LoggingProxyServer {
  private server: http.Server;
  private config: ProxyConfig;
  private currentInvocationId: string = '';
  private sequenceLock: Promise<void> = Promise.resolve();

  constructor(config: ProxyConfig) {
    this.config = config;
    this.server = http.createServer(this.handleRequest.bind(this));
    this.server.on('connect', this.handleConnect.bind(this));
  }

  /**
   * Set the current invocation ID.
   * Called when a new function invocation starts.
   */
  setInvocationId(invocationId: string): void {
    this.currentInvocationId = invocationId;
  }

  /**
   * Generate a new invocation ID.
   */
  newInvocation(): string {
    this.currentInvocationId = uuidv4();
    return this.currentInvocationId;
  }

  /**
   * Handle regular HTTP proxy requests.
   */
  private async handleRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse
  ): Promise<void> {
    try {
      const url = new URL(clientReq.url || '', `http://${clientReq.headers.host}`);

      // Log the request
      await this.logRequest({
        method: clientReq.method || 'GET',
        host: url.hostname,
        port: parseInt(url.port) || 80,
        path: url.pathname + url.search,
        protocol: 'http',
      });

      // Forward the request
      const proxyReq = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: clientReq.method,
          headers: this.filterHeaders(clientReq.headers),
        },
        (proxyRes) => {
          clientRes.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          proxyRes.pipe(clientRes);
        }
      );

      proxyReq.on('error', (err) => {
        console.error('Proxy request error:', err);
        clientRes.writeHead(502);
        clientRes.end('Bad Gateway');
      });

      clientReq.pipe(proxyReq);
    } catch (err) {
      console.error('Handle request error:', err);
      clientRes.writeHead(500);
      clientRes.end('Internal Server Error');
    }
  }

  /**
   * Handle HTTPS CONNECT requests (tunneling).
   */
  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: import('node:net').Socket,
    head: Buffer
  ): Promise<void> {
    try {
      const [host, portStr] = (req.url || '').split(':');
      const port = parseInt(portStr) || 443;

      // Log the HTTPS connection
      await this.logRequest({
        method: 'CONNECT',
        host,
        port,
        path: '/',
        protocol: 'https',
      });

      // Connect to the target
      const { connect } = await import('node:net');
      const serverSocket = connect(port, host, () => {
        clientSocket.write(
          'HTTP/1.1 200 Connection Established\r\n' +
            'Proxy-Agent: DShield-Proxy\r\n' +
            '\r\n'
        );
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      });

      serverSocket.on('error', (err) => {
        console.error('Server socket error:', err);
        clientSocket.end();
      });

      clientSocket.on('error', (err) => {
        console.error('Client socket error:', err);
        serverSocket.end();
      });
    } catch (err) {
      console.error('Handle connect error:', err);
      clientSocket.end();
    }
  }

  /**
   * Log a request with sequence number and signature.
   */
  private async logRequest(request: {
    method: string;
    host: string;
    port: number;
    path: string;
    protocol: 'http' | 'https';
  }): Promise<void> {
    // Use a lock to ensure sequence numbers are assigned atomically
    this.sequenceLock = this.sequenceLock.then(async () => {
      const sequence =
        (await this.config.logStore.getLatestSequence(this.config.functionId)) + 1;

      const entry: EgressLogEntry = {
        type: 'egress',
        sequence,
        functionId: this.config.functionId,
        invocationId: this.currentInvocationId,
        timestamp: new Date().toISOString(),
        method: request.method,
        host: request.host,
        port: request.port,
        path: request.path,
        protocol: request.protocol,
      };

      // Sign the entry
      const dataToSign = JSON.stringify(entry);
      const signature = this.config.signer.sign(dataToSign);

      const signedEntry: SignedLogEntry = {
        ...entry,
        signature,
      };

      await this.config.logStore.append(signedEntry);

      console.log(
        `[LOG] seq=${sequence} ${request.method} ${request.protocol}://${request.host}:${request.port}${request.path}`
      );
    });

    await this.sequenceLock;
  }

  /**
   * Filter headers to remove proxy-specific ones.
   */
  private filterHeaders(
    headers: http.IncomingHttpHeaders
  ): http.OutgoingHttpHeaders {
    const filtered: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== 'proxy-connection' &&
        lowerKey !== 'proxy-authorization'
      ) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  /**
   * Start the proxy server.
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.listenPort, '127.0.0.1', () => {
        // Update config with actual port (useful when port 0 is used for dynamic allocation)
        const addr = this.server.address();
        if (typeof addr === 'object' && addr) {
          this.config.listenPort = addr.port;
        }
        console.log(`D-Shield proxy listening on 127.0.0.1:${this.config.listenPort}`);
        resolve();
      });
    });
  }

  /**
   * Get the actual port the server is listening on.
   */
  getPort(): number {
    return this.config.listenPort;
  }

  /**
   * Stop the proxy server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Get the proxy URL for configuring HTTP_PROXY/HTTPS_PROXY.
   */
  getProxyUrl(): string {
    return `http://127.0.0.1:${this.config.listenPort}`;
  }
}
