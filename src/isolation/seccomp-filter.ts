/**
 * Seccomp Filter Configuration for D-Shield
 *
 * Layer 4 of the 4-layer network interception stack.
 * Restricts system calls to prevent network bypass attempts.
 *
 * This module generates seccomp-bpf rules that can be applied via:
 * - seccomp-tools (for testing)
 * - libseccomp (for runtime application)
 * - Docker's seccomp profile
 *
 * This module only works on Linux. On other platforms, it provides no-op functions.
 */

import { platform } from 'node:os';
import { writeFileSync } from 'node:fs';

/**
 * Seccomp action for blocked syscalls.
 */
export type SeccompAction =
  | 'SCMP_ACT_KILL'       // Kill the process
  | 'SCMP_ACT_KILL_PROCESS'// Kill the entire process group
  | 'SCMP_ACT_TRAP'       // Send SIGSYS
  | 'SCMP_ACT_ERRNO'      // Return errno
  | 'SCMP_ACT_TRACE'      // Notify ptrace tracer
  | 'SCMP_ACT_LOG'        // Log and allow
  | 'SCMP_ACT_ALLOW';     // Allow

/**
 * Docker-compatible seccomp profile structure.
 */
export interface SeccompProfile {
  defaultAction: SeccompAction;
  defaultErrnoRet?: number;
  architectures: string[];
  syscalls: SeccompSyscallRule[];
}

export interface SeccompSyscallRule {
  names: string[];
  action: SeccompAction;
  errnoRet?: number;
  args?: SeccompArg[];
}

export interface SeccompArg {
  index: number;
  value: number;
  valueTwo?: number;
  op: 'SCMP_CMP_NE' | 'SCMP_CMP_LT' | 'SCMP_CMP_LE' | 'SCMP_CMP_EQ' | 'SCMP_CMP_GE' | 'SCMP_CMP_GT' | 'SCMP_CMP_MASKED_EQ';
}

/**
 * Network-related syscalls that should be blocked or filtered.
 */
const NETWORK_SYSCALLS = [
  // Socket creation
  'socket',
  'socketpair',

  // Connection establishment
  'connect',
  'accept',
  'accept4',

  // Data transfer
  'send',
  'sendto',
  'sendmsg',
  'sendmmsg',
  'recv',
  'recvfrom',
  'recvmsg',
  'recvmmsg',

  // Socket options
  'setsockopt',
  'getsockopt',
  'bind',
  'listen',

  // DNS-related
  'getpeername',
  'getsockname',

  // Netlink (for modifying routes, etc.)
  'socket',  // Specifically AF_NETLINK
];

/**
 * Dangerous syscalls that could be used to escape isolation.
 */
const DANGEROUS_SYSCALLS = [
  // Process control that could bypass isolation
  'ptrace',           // Process tracing
  'process_vm_readv', // Read another process memory
  'process_vm_writev',// Write another process memory

  // Kernel module loading
  'init_module',
  'finit_module',
  'delete_module',

  // System configuration
  'syslog',
  'sysctl',
  'acct',

  // Mount operations
  'mount',
  'umount',
  'umount2',
  'pivot_root',

  // Namespace operations
  'setns',
  'unshare',

  // User/group manipulation
  'setuid',
  'setgid',
  'setreuid',
  'setregid',
  'setresuid',
  'setresgid',
  'setgroups',
];

/**
 * Socket domains (address families) - for argument filtering.
 */
const SOCKET_DOMAINS = {
  AF_UNIX: 1,
  AF_LOCAL: 1,
  AF_INET: 2,
  AF_INET6: 10,
  AF_NETLINK: 16,
  AF_PACKET: 17,
};

/**
 * Create a strict seccomp profile for D-Shield function sandboxes.
 * This profile blocks direct network access while allowing proxy communication.
 */
export function createStrictProfile(): SeccompProfile {
  return {
    defaultAction: 'SCMP_ACT_ALLOW',
    architectures: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_AARCH64'],
    syscalls: [
      // Block dangerous syscalls entirely
      {
        names: DANGEROUS_SYSCALLS,
        action: 'SCMP_ACT_ERRNO',
        errnoRet: 1, // EPERM
      },

      // Block raw socket creation (AF_PACKET, AF_NETLINK)
      {
        names: ['socket'],
        action: 'SCMP_ACT_ERRNO',
        errnoRet: 13, // EACCES
        args: [
          {
            index: 0,
            value: SOCKET_DOMAINS.AF_PACKET,
            op: 'SCMP_CMP_EQ',
          },
        ],
      },
      {
        names: ['socket'],
        action: 'SCMP_ACT_ERRNO',
        errnoRet: 13, // EACCES
        args: [
          {
            index: 0,
            value: SOCKET_DOMAINS.AF_NETLINK,
            op: 'SCMP_CMP_EQ',
          },
        ],
      },
    ],
  };
}

/**
 * Create a logging-only profile that logs network activity without blocking.
 * Useful for debugging and development.
 */
export function createLoggingProfile(): SeccompProfile {
  return {
    defaultAction: 'SCMP_ACT_ALLOW',
    architectures: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_AARCH64'],
    syscalls: [
      // Log all network syscalls
      {
        names: NETWORK_SYSCALLS,
        action: 'SCMP_ACT_LOG',
      },
    ],
  };
}

/**
 * Create a paranoid profile that blocks all network syscalls.
 * Only for environments where all networking goes through IPC.
 */
export function createParanoidProfile(): SeccompProfile {
  return {
    defaultAction: 'SCMP_ACT_ALLOW',
    architectures: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_AARCH64'],
    syscalls: [
      // Block all dangerous syscalls
      {
        names: DANGEROUS_SYSCALLS,
        action: 'SCMP_ACT_KILL_PROCESS',
      },

      // Block all network syscalls except Unix domain sockets
      {
        names: ['socket'],
        action: 'SCMP_ACT_ERRNO',
        errnoRet: 13,
        args: [
          {
            index: 0,
            value: SOCKET_DOMAINS.AF_INET,
            op: 'SCMP_CMP_EQ',
          },
        ],
      },
      {
        names: ['socket'],
        action: 'SCMP_ACT_ERRNO',
        errnoRet: 13,
        args: [
          {
            index: 0,
            value: SOCKET_DOMAINS.AF_INET6,
            op: 'SCMP_CMP_EQ',
          },
        ],
      },
      {
        names: ['socket'],
        action: 'SCMP_ACT_ERRNO',
        errnoRet: 13,
        args: [
          {
            index: 0,
            value: SOCKET_DOMAINS.AF_PACKET,
            op: 'SCMP_CMP_EQ',
          },
        ],
      },
      {
        names: ['socket'],
        action: 'SCMP_ACT_ERRNO',
        errnoRet: 13,
        args: [
          {
            index: 0,
            value: SOCKET_DOMAINS.AF_NETLINK,
            op: 'SCMP_CMP_EQ',
          },
        ],
      },
    ],
  };
}

/**
 * Write a seccomp profile to a JSON file (Docker format).
 */
export function writeProfileToFile(profile: SeccompProfile, path: string): void {
  writeFileSync(path, JSON.stringify(profile, null, 2));
}

/**
 * Check if seccomp is available on this platform.
 */
export function isSeccompSupported(): boolean {
  if (platform() !== 'linux') {
    return false;
  }

  try {
    // Check if seccomp is available by reading the kernel config
    const { execSync } = require('child_process');
    const result = execSync('grep CONFIG_SECCOMP /boot/config-$(uname -r) 2>/dev/null || true', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('CONFIG_SECCOMP=y');
  } catch {
    // If we can't check, assume it's available (most modern kernels have it)
    return true;
  }
}

/**
 * Get a recommended profile based on the environment.
 */
export function getRecommendedProfile(options?: {
  debug?: boolean;
  paranoid?: boolean;
}): SeccompProfile {
  if (options?.debug) {
    return createLoggingProfile();
  }

  if (options?.paranoid) {
    return createParanoidProfile();
  }

  return createStrictProfile();
}
