/**
 * D-Shield Isolation Layers
 *
 * This module provides the Linux-specific isolation mechanisms for D-Shield:
 *
 * Layer 1: Stdlib shims (Node.js) - src/shims/node-fetch-shim.ts
 * Layer 2: Network namespace isolation - Kernel-level network isolation
 * Layer 3: LD_PRELOAD shim - libc interception for native binaries
 * Layer 4: Seccomp filters - Syscall restriction
 *
 * Together, these layers ensure that ALL network traffic from user functions
 * is routed through the D-Shield logging proxy, with no bypass possible.
 */

export * from './network-namespace.js';
export * from './seccomp-filter.js';

import { platform } from 'node:os';
import { isNetworkNamespaceSupported } from './network-namespace.js';
import { isSeccompSupported } from './seccomp-filter.js';

/**
 * Environment capabilities for isolation.
 */
export interface IsolationCapabilities {
  /** Platform name */
  platform: string;
  /** Network namespace support */
  networkNamespace: boolean;
  /** LD_PRELOAD support (Linux only) */
  ldPreload: boolean;
  /** Seccomp support */
  seccomp: boolean;
  /** Overall isolation level */
  isolationLevel: 'full' | 'partial' | 'minimal';
}

/**
 * Check the current environment's isolation capabilities.
 */
export function getIsolationCapabilities(): IsolationCapabilities {
  const currentPlatform = platform();
  const isLinux = currentPlatform === 'linux';

  const capabilities: IsolationCapabilities = {
    platform: currentPlatform,
    networkNamespace: isNetworkNamespaceSupported(),
    ldPreload: isLinux,
    seccomp: isSeccompSupported(),
    isolationLevel: 'minimal',
  };

  // Determine overall isolation level
  if (capabilities.networkNamespace && capabilities.ldPreload && capabilities.seccomp) {
    capabilities.isolationLevel = 'full';
  } else if (capabilities.networkNamespace || capabilities.ldPreload) {
    capabilities.isolationLevel = 'partial';
  }

  return capabilities;
}

/**
 * Log isolation capabilities for diagnostics.
 */
export function logIsolationCapabilities(): void {
  const caps = getIsolationCapabilities();

  console.log('D-Shield Isolation Capabilities:');
  console.log(`  Platform: ${caps.platform}`);
  console.log(`  Network Namespace: ${caps.networkNamespace ? 'Yes' : 'No'}`);
  console.log(`  LD_PRELOAD: ${caps.ldPreload ? 'Yes' : 'No'}`);
  console.log(`  Seccomp: ${caps.seccomp ? 'Yes' : 'No'}`);
  console.log(`  Isolation Level: ${caps.isolationLevel.toUpperCase()}`);

  if (caps.isolationLevel !== 'full') {
    console.warn('');
    console.warn('WARNING: Full isolation requires Linux with root privileges.');
    console.warn('Network interception relies on HTTP_PROXY environment variables.');
  }
}
