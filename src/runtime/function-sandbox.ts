/**
 * Function Sandbox - Executes user code in isolated subprocess
 *
 * This module provides subprocess-based isolation for user functions.
 * All network calls from the subprocess are routed through the logging proxy
 * via environment variables (HTTP_PROXY, HTTPS_PROXY).
 *
 * On Linux, additional isolation layers are available:
 * - LD_PRELOAD shim for libc interception
 * - Network namespace isolation
 * - Seccomp syscall filtering
 */

import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  FunctionConfig,
  FunctionRequest,
  FunctionResponse,
  FunctionResult,
} from './types.js';

export interface SandboxConfig {
  /** Proxy URL for HTTP requests */
  httpProxy: string;

  /** Proxy URL for HTTPS requests */
  httpsProxy: string;

  /** Working directory for function execution */
  workDir: string;

  /** Enable LD_PRELOAD isolation (Linux only) */
  enableLdPreload?: boolean;

  /** Path to libdshield.so for LD_PRELOAD */
  ldPreloadPath?: string;

  /** Network namespace to run in (Linux only, requires root) */
  networkNamespace?: string;

  /** Proxy host for LD_PRELOAD shim */
  proxyHost?: string;

  /** Proxy port for LD_PRELOAD shim */
  proxyPort?: number;
}

export class FunctionSandbox {
  private config: SandboxConfig;
  private functionConfig: FunctionConfig;

  constructor(functionConfig: FunctionConfig, sandboxConfig: SandboxConfig) {
    this.functionConfig = functionConfig;
    this.config = sandboxConfig;
  }

  /**
   * Execute the function with the given request.
   */
  async execute(request: FunctionRequest): Promise<FunctionResult> {
    const invocationId = randomUUID();
    const startTime = Date.now();

    try {
      const response = await this.runInSubprocess(request, invocationId);

      return {
        success: true,
        response,
        durationMs: Date.now() - startTime,
        invocationId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        invocationId,
      };
    }
  }

  /**
   * Run the function in an isolated subprocess.
   */
  private async runInSubprocess(
    request: FunctionRequest,
    invocationId: string
  ): Promise<FunctionResponse> {
    const timeout = this.functionConfig.timeout || 30000;

    return new Promise((resolve, reject) => {
      const runtime = this.functionConfig.runtime;

      let child: ChildProcess;
      let command: string;
      let args: string[];

      // Build the wrapper script path
      const wrapperScript = this.getWrapperScript(runtime);

      if (runtime === 'node') {
        command = process.execPath; // Use current Node.js
        args = [
          '--experimental-vm-modules',
          wrapperScript,
          this.functionConfig.entryPoint,
          this.functionConfig.handler || 'handler',
        ];
      } else if (runtime === 'python') {
        command = 'python3';
        args = [
          wrapperScript,
          this.functionConfig.entryPoint,
          this.functionConfig.handler || 'handler',
        ];
      } else {
        throw new Error(`Unsupported runtime: ${runtime}`);
      }

      // Environment variables for the subprocess
      const env: Record<string, string> = {
        ...process.env,
        ...this.functionConfig.env,
        // Route all HTTP traffic through the logging proxy
        HTTP_PROXY: this.config.httpProxy,
        HTTPS_PROXY: this.config.httpsProxy,
        http_proxy: this.config.httpProxy,
        https_proxy: this.config.httpsProxy,
        // Pass invocation context
        DSHIELD_INVOCATION_ID: invocationId,
        DSHIELD_FUNCTION_ID: this.functionConfig.id,
        // Pass request as JSON via stdin
        DSHIELD_REQUEST: JSON.stringify(request),
      };

      // Add LD_PRELOAD isolation on Linux if enabled
      if (this.shouldUseLdPreload()) {
        const ldPreloadPath = this.config.ldPreloadPath || this.getDefaultLdPreloadPath();
        if (ldPreloadPath && existsSync(ldPreloadPath)) {
          env.LD_PRELOAD = ldPreloadPath;
          env.DSHIELD_PROXY_HOST = this.config.proxyHost || '127.0.0.1';
          env.DSHIELD_PROXY_PORT = String(this.config.proxyPort || 8080);
        }
      }

      // Wrap command with network namespace if configured
      if (this.config.networkNamespace && platform() === 'linux') {
        args = ['netns', 'exec', this.config.networkNamespace, command, ...args];
        command = 'ip';
      }

      child = spawn(command, args, {
        cwd: this.config.workDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Set timeout
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Function timed out after ${timeout}ms`));
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);

        if (code !== 0) {
          reject(new Error(`Function exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Parse the response from stdout
          const response = JSON.parse(stdout) as FunctionResponse;
          resolve(response);
        } catch {
          reject(new Error(`Invalid function response: ${stdout}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      // Send request via stdin and close
      child.stdin?.write(JSON.stringify(request));
      child.stdin?.end();
    });
  }

  /**
   * Get the path to the wrapper script for the given runtime.
   */
  private getWrapperScript(runtime: 'node' | 'python'): string {
    const currentFile = fileURLToPath(import.meta.url);
    const scriptDir = path.join(path.dirname(currentFile), 'wrappers');

    if (runtime === 'node') {
      return path.join(scriptDir, 'node-wrapper.mjs');
    } else {
      return path.join(scriptDir, 'python-wrapper.py');
    }
  }

  /**
   * Check if LD_PRELOAD should be used for this sandbox.
   */
  private shouldUseLdPreload(): boolean {
    // Only on Linux
    if (platform() !== 'linux') {
      return false;
    }

    // Must be explicitly enabled
    return this.config.enableLdPreload === true;
  }

  /**
   * Get the default path to libdshield.so.
   */
  private getDefaultLdPreloadPath(): string | null {
    const currentFile = fileURLToPath(import.meta.url);
    const possiblePaths = [
      // In the build directory (during Docker deployment)
      path.resolve(process.cwd(), 'build/isolation/libdshield.so'),
      // Relative to this module
      path.resolve(path.dirname(currentFile), '../../build/isolation/libdshield.so'),
      // System-wide location
      '/usr/local/lib/libdshield.so',
    ];

    for (const p of possiblePaths) {
      if (existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Get isolation status information.
   */
  getIsolationStatus(): {
    httpProxy: boolean;
    ldPreload: boolean;
    networkNamespace: boolean;
  } {
    return {
      httpProxy: !!(this.config.httpProxy && this.config.httpsProxy),
      ldPreload: this.shouldUseLdPreload() && !!this.getDefaultLdPreloadPath(),
      networkNamespace: !!(this.config.networkNamespace && platform() === 'linux'),
    };
  }
}

/**
 * Create a sandbox for the given function configuration.
 */
export function createSandbox(
  functionConfig: FunctionConfig,
  sandboxConfig: SandboxConfig
): FunctionSandbox {
  return new FunctionSandbox(functionConfig, sandboxConfig);
}
