# D-Shield Deployment Guide

This guide covers deploying D-Shield to Phala Network's d-stack platform.

## Prerequisites

- Docker installed locally
- Phala Cloud account (https://cloud.phala.network)
- `dstack` CLI tool installed

## Quick Start (Local)

### 1. Build the Docker Image

```bash
docker build -t dshield:latest .
```

### 2. Run Locally

```bash
# Basic run
docker run -p 3000:3000 dshield:latest

# With custom functions directory
docker run -p 3000:3000 -v $(pwd)/functions:/app/functions dshield:latest

# With environment variables
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-... \
  -e LOG_LEVEL=debug \
  dshield:latest
```

### 3. Test the Deployment

```bash
# Health check
curl http://localhost:3000/health

# List functions
curl http://localhost:3000/functions

# Invoke a function
curl -X POST http://localhost:3000/invoke/hello \
  -H "Content-Type: application/json" \
  -d '{"message": "world"}'

# Get logs
curl http://localhost:3000/logs/hello

# Get public key for verification
curl http://localhost:3000/publicKey
```

## Phala Deployment

### 1. Prepare Configuration

Create a `dshield.config.json`:

```json
{
  "port": 3000,
  "functions": [
    {
      "id": "my-function",
      "name": "My Function",
      "entryPoint": "./functions/my-function.mjs",
      "runtime": "node",
      "handler": "handler",
      "timeout": 30000,
      "env": {}
    }
  ]
}
```

### 2. Create docker-compose.yml

The repository includes a ready-to-use `docker-compose.yml` for d-stack:

```yaml
version: '3.8'
services:
  dshield:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./functions:/app/functions
      - ./dshield.config.json:/app/dshield.config.json
    environment:
      - NODE_ENV=production
      - DSHIELD_CONFIG=/app/dshield.config.json
    restart: unless-stopped
```

### 3. Deploy to Phala Cloud

```bash
# Login to Phala Cloud
dstack login

# Deploy the application
dstack deploy --name dshield ./

# Get deployment status
dstack status dshield

# Get the public endpoint
dstack info dshield
```

### 4. Verify Attestation

Once deployed, verify the TEE attestation:

```bash
# Get attestation report
curl https://your-deployment.phala.network/attestation

# The attestation proves:
# - D-Shield runtime code hash
# - Configuration (egress whitelist)
# - TEE hardware signature
```

## Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DSHIELD_PORT` | HTTP server port | `3000` |
| `DSHIELD_CONFIG` | Path to config file | `./dshield.config.json` |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `NODE_ENV` | Environment mode | `development` |

### Function Configuration

Each function in the config requires:

```json
{
  "id": "unique-id",        // Required: URL-safe identifier
  "name": "Display Name",   // Required: Human-readable name
  "entryPoint": "./path",   // Required: Path to function file
  "runtime": "node",        // Required: "node" or "python"
  "handler": "handler",     // Optional: Export name (default: "handler")
  "timeout": 30000,         // Optional: Timeout in ms (default: 30000)
  "env": {}                 // Optional: Environment variables
}
```

## Isolation Layers

D-Shield implements 4 layers of network isolation:

### Layer 1: HTTP_PROXY Environment
All function code respects `HTTP_PROXY`/`HTTPS_PROXY` environment variables.

### Layer 2: Network Namespace (Linux)
On Linux, functions run in isolated network namespaces with restricted egress.

### Layer 3: LD_PRELOAD (Linux)
Native libraries have network calls intercepted at the libc level.

### Layer 4: Seccomp (Linux)
Syscall filtering blocks unauthorized network operations.

To enable all isolation layers (Linux only):

```bash
# In Docker
docker run --privileged dshield:latest

# Or with specific capabilities
docker run --cap-add=NET_ADMIN --cap-add=SYS_PTRACE dshield:latest
```

## Verifying Logs

### Get Public Key

```bash
curl https://your-deployment.phala.network/publicKey
```

### Fetch Logs

```bash
curl https://your-deployment.phala.network/logs/function-id
```

### Verify Log Integrity

```javascript
import { verifyLogIntegrity } from 'dshield/log-store';

const publicKey = await fetch('/publicKey').then(r => r.json());
const logs = await fetch('/logs/my-function').then(r => r.json());

const result = await verifyLogIntegrity(logs.entries, publicKey.publicKey);

if (result.valid) {
  console.log('All logs verified!');
  console.log('Total entries:', result.count);
} else {
  console.error('Verification failed:', result.errors);
}
```

## Troubleshooting

### Function Times Out

- Increase the `timeout` in function config
- Check if external API is reachable through proxy

### Logs Not Appearing

- Verify function is making HTTP requests (not bypassing proxy)
- Check `LOG_LEVEL=debug` for detailed logging

### Attestation Fails

- Ensure you're on a TDX-enabled host
- Verify the container image hash matches expected

### Proxy Connection Refused

- Check if port 3000 is exposed
- Verify no firewall blocking internal proxy (port 8080)

## Security Considerations

1. **Never expose the proxy port directly** - Only the D-Shield HTTP server should be public

2. **Rotate keys periodically** - Generate new signing keys for each deployment

3. **Verify attestation** - Always verify the TEE attestation before trusting logs

4. **Review egress whitelist** - Ensure only necessary endpoints are allowed
