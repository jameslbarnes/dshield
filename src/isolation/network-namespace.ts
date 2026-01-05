/**
 * Network Namespace Isolation for D-Shield
 *
 * Layer 2 of the 4-layer network interception stack.
 * Creates isolated network namespaces that force all traffic through the proxy.
 *
 * This module only works on Linux. On other platforms, it gracefully degrades.
 */

import { spawn, execSync } from 'node:child_process';
import { platform } from 'node:os';

export interface NetworkNamespaceConfig {
  /** Name for the network namespace */
  namespaceName: string;
  /** Proxy host to allow traffic to */
  proxyHost: string;
  /** Proxy port to allow traffic to */
  proxyPort: number;
  /** Veth interface name for host side */
  hostVeth?: string;
  /** Veth interface name for namespace side */
  nsVeth?: string;
  /** IP address for namespace veth */
  nsIp?: string;
  /** IP address for host veth */
  hostIp?: string;
}

export interface NetworkNamespace {
  /** Namespace name */
  name: string;
  /** Execute a command in this namespace */
  exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Clean up the namespace */
  destroy(): Promise<void>;
}

const DEFAULT_CONFIG: Partial<NetworkNamespaceConfig> = {
  hostVeth: 'veth-host',
  nsVeth: 'veth-ns',
  nsIp: '10.200.1.2/24',
  hostIp: '10.200.1.1/24',
};

/**
 * Check if we're running on Linux with required capabilities.
 */
export function isNetworkNamespaceSupported(): boolean {
  if (platform() !== 'linux') {
    return false;
  }

  try {
    // Check if ip netns command is available
    execSync('ip netns help', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a network namespace with restricted egress.
 * All traffic is forced through the D-Shield proxy.
 */
export async function createNetworkNamespace(
  config: NetworkNamespaceConfig
): Promise<NetworkNamespace> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const { namespaceName, proxyHost, proxyPort, hostVeth, nsVeth, nsIp, hostIp } = fullConfig as Required<NetworkNamespaceConfig>;

  if (!isNetworkNamespaceSupported()) {
    console.warn('Network namespace isolation not supported on this platform');
    return createNoopNamespace(namespaceName);
  }

  try {
    // Create the network namespace
    execSync(`ip netns add ${namespaceName}`, { stdio: 'pipe' });

    // Create veth pair
    execSync(`ip link add ${hostVeth} type veth peer name ${nsVeth}`, { stdio: 'pipe' });

    // Move one end to the namespace
    execSync(`ip link set ${nsVeth} netns ${namespaceName}`, { stdio: 'pipe' });

    // Configure host veth
    execSync(`ip addr add ${hostIp} dev ${hostVeth}`, { stdio: 'pipe' });
    execSync(`ip link set ${hostVeth} up`, { stdio: 'pipe' });

    // Configure namespace veth
    execSync(`ip netns exec ${namespaceName} ip addr add ${nsIp} dev ${nsVeth}`, { stdio: 'pipe' });
    execSync(`ip netns exec ${namespaceName} ip link set ${nsVeth} up`, { stdio: 'pipe' });
    execSync(`ip netns exec ${namespaceName} ip link set lo up`, { stdio: 'pipe' });

    // Add default route through host veth
    const hostIpAddr = hostIp.split('/')[0];
    execSync(`ip netns exec ${namespaceName} ip route add default via ${hostIpAddr}`, { stdio: 'pipe' });

    // Set up iptables rules in the namespace to only allow proxy traffic
    await setupNamespaceFirewall(namespaceName, proxyHost, proxyPort);

    // Enable IP forwarding and NAT on host
    execSync('echo 1 > /proc/sys/net/ipv4/ip_forward', { stdio: 'pipe' });
    execSync(`iptables -t nat -A POSTROUTING -s ${nsIp.split('/')[0]} -j MASQUERADE`, { stdio: 'pipe' });

    console.log(`Network namespace '${namespaceName}' created with proxy routing`);

    return {
      name: namespaceName,
      exec: (command, args) => execInNamespace(namespaceName, command, args),
      destroy: () => destroyNamespace(namespaceName, hostVeth, nsIp),
    };
  } catch (error) {
    // Clean up on failure
    try {
      execSync(`ip netns del ${namespaceName}`, { stdio: 'pipe' });
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(`Failed to create network namespace: ${error}`);
  }
}

/**
 * Set up firewall rules in the namespace to restrict egress.
 */
async function setupNamespaceFirewall(
  namespaceName: string,
  proxyHost: string,
  proxyPort: number
): Promise<void> {
  const nsExec = (cmd: string) => execSync(`ip netns exec ${namespaceName} ${cmd}`, { stdio: 'pipe' });

  // Default policies: drop everything
  nsExec('iptables -P INPUT DROP');
  nsExec('iptables -P OUTPUT DROP');
  nsExec('iptables -P FORWARD DROP');

  // Allow loopback
  nsExec('iptables -A INPUT -i lo -j ACCEPT');
  nsExec('iptables -A OUTPUT -o lo -j ACCEPT');

  // Allow established connections
  nsExec('iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT');
  nsExec('iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT');

  // Allow traffic to the proxy only
  nsExec(`iptables -A OUTPUT -p tcp -d ${proxyHost} --dport ${proxyPort} -j ACCEPT`);

  // Allow DNS (needed for proxy to resolve hostnames)
  nsExec('iptables -A OUTPUT -p udp --dport 53 -j ACCEPT');
  nsExec('iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT');

  console.log(`Firewall configured: only ${proxyHost}:${proxyPort} and DNS allowed`);
}

/**
 * Execute a command inside a network namespace.
 */
async function execInNamespace(
  namespaceName: string,
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('ip', ['netns', 'exec', namespaceName, command, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Destroy a network namespace and clean up resources.
 */
async function destroyNamespace(
  namespaceName: string,
  hostVeth: string,
  nsIp: string
): Promise<void> {
  try {
    // Remove NAT rule
    try {
      execSync(`iptables -t nat -D POSTROUTING -s ${nsIp.split('/')[0]} -j MASQUERADE`, { stdio: 'pipe' });
    } catch {
      // Rule may not exist
    }

    // Delete host veth (also removes ns veth)
    try {
      execSync(`ip link del ${hostVeth}`, { stdio: 'pipe' });
    } catch {
      // Interface may not exist
    }

    // Delete the namespace
    execSync(`ip netns del ${namespaceName}`, { stdio: 'pipe' });
    console.log(`Network namespace '${namespaceName}' destroyed`);
  } catch (error) {
    console.error(`Error destroying namespace: ${error}`);
  }
}

/**
 * Create a no-op namespace for non-Linux platforms.
 */
function createNoopNamespace(name: string): NetworkNamespace {
  return {
    name,
    exec: async (command, args) => {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        });

        child.on('error', reject);
      });
    },
    destroy: async () => {
      // No-op
    },
  };
}
