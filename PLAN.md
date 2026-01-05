# D-Shield Implementation Plan

## Current Status (Updated)

### Completed ✅
- **Logging Proxy**: HTTP/HTTPS proxy with signed, sequenced log entries
- **TEE Signer**: RSA signing with exportable keys (ready for TEE integration)
- **Log Store**: In-memory store + Firestore backend
- **Log Integrity**: Signature verification + sequence gap detection
- **Runtime Server**: HTTP server with function invocation endpoints
- **Function Sandbox**: Subprocess-based isolation with proxy routing
- **Node.js Support**: Wrapper script for Node.js functions
- **Python Support**: Wrapper script for Python functions
- **Docker Setup**: Dockerfile and docker-compose for Phala deployment
- **CLI**: Command-line interface for starting the runtime
- **Linux Isolation Layers**:
  - LD_PRELOAD shim (`src/isolation/ld-preload-shim.c`) - intercepts libc network calls
  - Network namespace (`src/isolation/network-namespace.ts`) - kernel-level isolation
  - Seccomp filters (`src/isolation/seccomp-filter.ts`) - syscall restriction
  - Setup script (`scripts/setup-isolation.sh`) - Docker deployment initialization
- **End-to-end Tests**: Integration tests for runtime, function invocation, and log verification (86 tests passing)
- **Deployment Documentation**: Guide for local Docker and Phala Cloud deployment

### Remaining
- **Phala Deployment**: Deploy to d-stack and verify attestation

---

## Executive Summary

D-Shield provides **egress-attested serverless functions** on Phala Network. The core value proposition: cryptographic proof of WHERE data goes (egress whitelist), not what the code does—enabling proprietary logic with verifiable privacy guarantees.

**Key Insight**: If we can attest that a function only talks to `api.anthropic.com`, that's equivalent to open-sourcing for the privacy guarantees users care about.

---

## Critical Research Findings

### 1. Platform Shift: SGX → TDX

**Phala is deprecating SGX** due to the WireTap vulnerability (sub-$1,000 DDR4 DRAM bus snooping attack). The platform is migrating to:
- **Intel TDX** (Trust Domain Extensions) - DDR5 platforms, outside WireTap scope
- **NVIDIA Confidential Computing** - For GPU-backed AI workloads

**Implication**: D-Shield should target TDX from the start, not SGX.

### 2. d-stack Architecture

| Component | What It Does |
|-----------|--------------|
| `dstack-vmm` | Manages Confidential VMs (CVMs) on bare TDX hosts |
| `dstack-gateway` | Reverse proxy, Zero Trust HTTPS, TLS termination |
| `dstack-kms` | Key Management Service, deterministic encryption keys |
| `dstack-guest-agent` | Runs inside CVM, serves attestation requests |

**Deployment Model**: Standard `docker-compose.yaml` files, no code modifications required. Any OCI-compatible container can deploy.

### 3. Attestation Contents (Current)

The "Phala Attestation Bundle" includes:
- Code/image hash
- Runtime information
- Container arguments and environment variables
- Node signature and timestamps
- Cryptographically signed by enclave hardware

**Gap**: No explicit mechanism for custom claims (like egress whitelist).

### 4. Egress Control: The Hard Problem

**Critical Discovery**: iptables/nftables rules CANNOT be directly included in TEE attestation.

- MRENCLAVE measures enclave memory at initialization only
- Network policies are external to the enclave
- Firewall rules are not part of the measurement

**Solution**: Egress policy must be **embedded in the measured code itself**.

---

## Architectural Approach

### The D-Shield Runtime Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Phala CVM (TDX)                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │         D-Shield Runtime (OPEN SOURCE, MEASURED)        ││
│  │                                                         ││
│  │  ┌─────────────────┐     ┌─────────────────┐           ││
│  │  │   User Code A   │     │   User Code B   │           ││
│  │  │  (proprietary)  │     │  (proprietary)  │           ││
│  │  │                 │     │                 │           ││
│  │  │ [No direct net] │     │ [No direct net] │           ││
│  │  └────────┬────────┘     └────────┬────────┘           ││
│  │           │                       │                     ││
│  │           └───────────┬───────────┘                     ││
│  │                       ▼                                 ││
│  │  ┌─────────────────────────────────────────────────┐   ││
│  │  │              EGRESS ENFORCER                     │   ││
│  │  │  • Whitelist baked into runtime                  │   ││
│  │  │  • All HTTP(S) calls intercepted                 │   ││
│  │  │  • DNS resolution controlled                     │   ││
│  │  │  • TLS termination inside enclave                │   ││
│  │  └─────────────────────┬───────────────────────────┘   ││
│  └────────────────────────┼────────────────────────────────┘│
│                           │                                 │
│  ┌────────────────────────┼────────────────────────────────┐│
│  │      ATTESTATION INCLUDES:                              ││
│  │  • D-Shield runtime hash (verifies egress logic)        ││
│  │  • Egress whitelist (config file, part of image)        ││
│  │  • Policy flags (memory-only, logging level)            ││
│  │  • User code hash (optional, for extra verification)    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ ONLY whitelisted endpoints
                  ┌─────────────────────┐
                  │  api.anthropic.com  │
                  └─────────────────────┘
```

### Why This Works

1. **D-Shield runtime is open source** → Anyone can audit the egress enforcement logic
2. **Runtime is measured** → Attestation proves "this exact egress enforcer is running"
3. **User code has no direct network** → Must go through egress enforcer
4. **Whitelist is config, not code** → Part of container image, measured in attestation
5. **User code is proprietary but constrained** → Can't exfiltrate because enforcer blocks it

### Egress Enforcement Options

| Option | Pros | Cons |
|--------|------|------|
| **A: HTTP Proxy (HTTPS_PROXY env)** | Simple, works with most libs | Requires app cooperation |
| **B: Transparent Proxy (iptables REDIRECT)** | Works with all apps | Complex, may conflict with d-stack |
| **C: seccomp + Proxy** | Strongest isolation | Higher complexity |
| **D: DNS + TLS interception** | Catches everything | Complex TLS handling |

**Recommended for MVP**: Option A (HTTP Proxy) with Option C as stretch goal.

---

## Critical Questions for Phala Team

### Must Answer Before Coding

1. **TDX Availability**: When will TDX be available on Phala Cloud? Can we get early access?

2. **Attestation Extension**: Can we add custom claims (egress whitelist hash) to attestation? How?

3. **Network Stack Inside CVM**:
   - Can we run iptables inside the CVM?
   - Does d-stack networking interfere with transparent proxying?
   - Is there an existing egress control mechanism we can hook into?

4. **Runtime Measurement Granularity**:
   - Is the entire container image measured, or just specific files?
   - Can we ensure config files (whitelist) are included in measurement?

5. **Multi-Container CVMs**: Can multiple containers share a CVM with isolated networking between them?

---

## Research Spikes (Prioritized)

### Spike 1: Attestation Deep Dive (CRITICAL PATH)
**Goal**: Understand exactly what gets attested and how to extend it.

**Tasks**:
- [ ] Deploy minimal d-stack app on Phala Cloud
- [ ] Generate attestation bundle
- [ ] Inspect contents (MRENCLAVE/MRTD, custom claims)
- [ ] Document how to add egress whitelist to attestation
- [ ] Test verification process

**Output**: Technical doc on attestation capabilities and gaps.

### Spike 2: Network Interception in CVM
**Goal**: Validate that egress enforcement is technically feasible.

**Tasks**:
- [ ] Deploy CVM with two containers (proxy + app)
- [ ] Test iptables REDIRECT inside CVM
- [ ] Test HTTPS_PROXY environment variable
- [ ] Measure latency overhead of proxy approach
- [ ] Document any d-stack networking conflicts

**Output**: Working prototype of traffic interception.

### Spike 3: User Code Isolation
**Goal**: Ensure user code cannot bypass egress enforcer.

**Tasks**:
- [ ] Test subprocess model (user code as child process)
- [ ] Test seccomp filters to block direct socket syscalls
- [ ] Test namespace isolation within CVM
- [ ] Evaluate V8 isolates vs subprocess vs container-in-container

**Output**: Recommended isolation architecture.

### Spike 4: Verification UX
**Goal**: Understand how users will verify D-Shield deployments.

**Tasks**:
- [ ] Document current Phala attestation verification flow
- [ ] Identify gaps for D-Shield-specific verification
- [ ] Prototype verification page/CLI
- [ ] Design "trust badge" for D-Shield deployments

**Output**: Verification UX mockups and requirements.

---

## MVP Scope

### What MVP Includes
- Single function deployment
- Single egress endpoint (`api.anthropic.com`)
- HTTP proxy-based egress enforcement
- Attestation includes egress whitelist
- Basic verification documentation

### What MVP Excludes
- Multiple functions per deployment
- Dynamic egress whitelist updates
- Custom verification UI
- Fan-out/streaming patterns
- Persistent storage

### Success Criteria
1. User can deploy a function that calls Anthropic API
2. Attestation proves the egress whitelist
3. Attempts to call non-whitelisted endpoints fail
4. Third party can verify the deployment

---

## Implementation Phases

### Phase 1: Validated Architecture
**Focus**: Prove the approach works on d-stack/Phala

- Complete Spikes 1-2
- Get answers from Phala team
- Build proof-of-concept egress enforcer
- Document attestation flow

### Phase 2: MVP Runtime
**Focus**: Usable single-function deployment

- D-Shield runtime container (open source)
- HTTP proxy egress enforcer
- Egress whitelist in config file
- Deployment script/CLI wrapper
- Verification documentation

### Phase 3: Developer Experience
**Focus**: Make it easy to use

- `dshield` CLI tool
- Local development mode (no TEE)
- Attestation verification service
- Documentation and examples

### Phase 4: Production Features
**Focus**: Real-world requirements

- Multiple functions per deployment
- Streaming/fan-out support
- Dynamic whitelist updates
- Monitoring and logging
- Multi-tenant isolation

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| TDX not available yet | High | Start with SGX, design for TDX migration |
| Can't extend attestation | High | Work with Phala team, may need d-stack changes |
| Proxy adds latency | Medium | Optimize, use in-process proxy |
| User code escapes sandbox | High | Multiple isolation layers, security audit |
| d-stack networking conflicts | Medium | Early spike, fallback to simpler proxy |

---

## Next Steps

1. **Immediate**: Send questions to Phala team (see "Critical Questions" above)
2. **This week**: Begin Spike 1 (Attestation Deep Dive)
3. **Parallel**: Set up development environment, explore d-stack codebase
4. **Decision point**: After Spike 1-2, confirm architecture or pivot

---

## Open Questions Log

- [ ] What is the cold start time for a d-stack CVM?
- [ ] Memory limits on Phala TDX instances?
- [ ] Billing model: per-CVM, per-compute, per-request?
- [ ] Can attestation be refreshed without restarting CVM?
- [ ] How does secret injection work for API keys?
- [ ] Is there a staging/testnet environment?
