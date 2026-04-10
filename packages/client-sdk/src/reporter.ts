/**
 * Reporter - sends logs to Auditor server
 */

import type { ClientEgressLog } from './types.js';

export interface ReporterConfig {
  endpoint: string;
  apiKey: string;
  appId: string;
  flushInterval: number;
  maxBufferSize: number;
}

export class Reporter {
  private config: ReporterConfig;
  private buffer: ClientEgressLog[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  constructor(config: ReporterConfig) {
    this.config = config;
    this.startFlushTimer();
  }

  add(log: ClientEgressLog): void {
    this.buffer.push(log);

    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) return;

    this.isFlushing = true;
    const logsToSend = [...this.buffer];
    this.buffer = [];

    try {
      // Use the original fetch to avoid infinite loop
      const originalFetch = (window as { __auditor_original_fetch?: typeof fetch }).__auditor_original_fetch || fetch;

      await originalFetch(`${this.config.endpoint}/api/client-logs/${this.config.appId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ logs: logsToSend }),
      });
    } catch (error) {
      // On failure, add logs back to buffer
      this.buffer = [...logsToSend, ...this.buffer];
      console.warn('[Auditor] Failed to send logs:', error);
    } finally {
      this.isFlushing = false;
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush
    this.flush();
  }
}
