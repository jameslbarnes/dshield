#!/bin/bash
# D-Shield Isolation Layer Setup Script
#
# This script sets up the Linux isolation layers for D-Shield:
# - Compiles the LD_PRELOAD shim
# - Generates seccomp profile
# - Configures network namespace (if running as root)
#
# Run this script during Docker container initialization.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build/isolation"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Create build directory
mkdir -p "$BUILD_DIR"

# Check for required tools
check_tools() {
    log_info "Checking required tools..."

    if ! command -v gcc &> /dev/null; then
        log_warn "GCC not found. LD_PRELOAD shim will not be compiled."
        return 1
    fi

    log_info "All required tools found."
    return 0
}

# Compile LD_PRELOAD shim
compile_ld_preload() {
    log_info "Compiling LD_PRELOAD shim..."

    local SRC="$PROJECT_DIR/src/isolation/ld-preload-shim.c"
    local OUT="$BUILD_DIR/libdshield.so"

    if [ ! -f "$SRC" ]; then
        log_error "Source file not found: $SRC"
        return 1
    fi

    gcc -shared -fPIC -o "$OUT" "$SRC" -ldl -Wall -Wextra

    if [ $? -eq 0 ]; then
        log_info "LD_PRELOAD shim compiled: $OUT"
        chmod 755 "$OUT"
    else
        log_error "Failed to compile LD_PRELOAD shim"
        return 1
    fi
}

# Generate seccomp profile
generate_seccomp() {
    log_info "Generating seccomp profile..."

    local OUT="$BUILD_DIR/seccomp-profile.json"

    # Use Node.js to generate the profile
    node -e "
const { createStrictProfile, writeProfileToFile } = require('$PROJECT_DIR/dist/isolation/seccomp-filter.js');
const profile = createStrictProfile();
writeProfileToFile(profile, '$OUT');
console.log('Seccomp profile written to: $OUT');
" 2>/dev/null || {
        # Fallback: create a basic profile
        cat > "$OUT" << 'EOF'
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "architectures": ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
  "syscalls": [
    {
      "names": ["ptrace", "process_vm_readv", "process_vm_writev", "init_module", "finit_module", "delete_module"],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1
    }
  ]
}
EOF
        log_info "Basic seccomp profile written to: $OUT"
    }
}

# Set up network namespace (requires root)
setup_network_namespace() {
    if [ "$EUID" -ne 0 ]; then
        log_warn "Network namespace setup requires root privileges. Skipping."
        return 0
    fi

    log_info "Setting up network namespace..."

    local NS_NAME="dshield-sandbox"
    local PROXY_PORT="${DSHIELD_PROXY_PORT:-8080}"

    # Check if namespace already exists
    if ip netns list | grep -q "$NS_NAME"; then
        log_info "Namespace '$NS_NAME' already exists"
        return 0
    fi

    # Create namespace
    ip netns add "$NS_NAME"

    # Create veth pair
    ip link add veth-host type veth peer name veth-ns
    ip link set veth-ns netns "$NS_NAME"

    # Configure host side
    ip addr add 10.200.1.1/24 dev veth-host
    ip link set veth-host up

    # Configure namespace side
    ip netns exec "$NS_NAME" ip addr add 10.200.1.2/24 dev veth-ns
    ip netns exec "$NS_NAME" ip link set veth-ns up
    ip netns exec "$NS_NAME" ip link set lo up
    ip netns exec "$NS_NAME" ip route add default via 10.200.1.1

    # Enable IP forwarding
    echo 1 > /proc/sys/net/ipv4/ip_forward

    # Set up NAT for proxy access
    iptables -t nat -A POSTROUTING -s 10.200.1.0/24 -j MASQUERADE

    # Configure namespace firewall
    ip netns exec "$NS_NAME" iptables -P OUTPUT DROP
    ip netns exec "$NS_NAME" iptables -A OUTPUT -o lo -j ACCEPT
    ip netns exec "$NS_NAME" iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
    ip netns exec "$NS_NAME" iptables -A OUTPUT -p tcp -d 10.200.1.1 --dport "$PROXY_PORT" -j ACCEPT
    ip netns exec "$NS_NAME" iptables -A OUTPUT -p udp --dport 53 -j ACCEPT

    log_info "Network namespace '$NS_NAME' configured"
}

# Create environment setup script
create_env_script() {
    log_info "Creating environment setup script..."

    local OUT="$BUILD_DIR/dshield-env.sh"

    cat > "$OUT" << EOF
#!/bin/bash
# D-Shield Environment Setup
# Source this file to enable D-Shield isolation for a process

export LD_PRELOAD="$BUILD_DIR/libdshield.so"
export DSHIELD_PROXY_HOST="\${DSHIELD_PROXY_HOST:-127.0.0.1}"
export DSHIELD_PROXY_PORT="\${DSHIELD_PROXY_PORT:-8080}"
export HTTP_PROXY="http://\${DSHIELD_PROXY_HOST}:\${DSHIELD_PROXY_PORT}"
export HTTPS_PROXY="http://\${DSHIELD_PROXY_HOST}:\${DSHIELD_PROXY_PORT}"

echo "D-Shield environment configured:"
echo "  LD_PRELOAD: \$LD_PRELOAD"
echo "  HTTP_PROXY: \$HTTP_PROXY"
echo "  HTTPS_PROXY: \$HTTPS_PROXY"
EOF

    chmod +x "$OUT"
    log_info "Environment script created: $OUT"
}

# Main setup
main() {
    echo "======================================"
    echo "D-Shield Isolation Layer Setup"
    echo "======================================"

    # Check tools
    if check_tools; then
        compile_ld_preload
    fi

    generate_seccomp
    setup_network_namespace
    create_env_script

    echo ""
    echo "======================================"
    log_info "Setup complete!"
    echo ""
    echo "To enable isolation for a process:"
    echo "  source $BUILD_DIR/dshield-env.sh"
    echo "  ./your-program"
    echo ""
    echo "Or run in the network namespace:"
    echo "  ip netns exec dshield-sandbox ./your-program"
    echo "======================================"
}

main "$@"
