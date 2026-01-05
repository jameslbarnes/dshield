# D-Shield

**Egress-attested serverless functions on Phala Network.**

D-Shield provides cryptographic proof of WHERE your data goes (egress whitelist), not what the code does—enabling proprietary logic with verifiable privacy guarantees.

## Key Insight

If we can attest that a function only talks to `api.anthropic.com`, that's equivalent to open-sourcing for the privacy guarantees users care about.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Phala CVM (TDX)                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │         D-Shield Runtime (OPEN SOURCE, MEASURED)        ││
│  │                                                         ││
│  │  ┌─────────────────┐     ┌─────────────────┐           ││
│  │  │   User Code A   │     │   User Code B   │           ││
│  │  │  (proprietary)  │     │  (proprietary)  │           ││
│  │  │ [No direct net] │     │ [No direct net] │           ││
│  │  └────────┬────────┘     └────────┬────────┘           ││
│  │           └───────────┬───────────┘                     ││
│  │                       ▼                                 ││
│  │  ┌─────────────────────────────────────────────────┐   ││
│  │  │              LOGGING PROXY                       │   ││
│  │  │  • All HTTP(S) calls intercepted & logged       │   ││
│  │  │  • TEE-signed log entries with sequence numbers │   ││
│  │  │  • Tamper-evident audit trail                   │   ││
│  │  └─────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Features

- **Transparent Logging**: All outbound API calls are logged with cryptographic signatures
- **Tamper-Evident**: Sequential numbering detects missing/modified entries
- **TEE Attestation**: Proves the D-Shield runtime is running unmodified
- **Multi-Runtime**: Supports Node.js and Python functions
- **4-Layer Isolation**: Stdlib shims, LD_PRELOAD, network namespace, seccomp
- **Client Code Transparency**: Sign and publish client builds for end-to-end verification

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start the runtime
npm run dev -- --functions ./examples

# Or build and run
npm run build
npm start -- --functions ./examples
```

### Docker

```bash
# Build image
docker build -t dshield:latest .

# Run locally
docker run -p 3000:3000 dshield:latest
```

### Deploy to Phala

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full deployment instructions.

## API

### Invoke a Function
```bash
curl -X POST http://localhost:3000/invoke/my-function \
  -H "Content-Type: application/json" \
  -d '{"input": "data"}'
```

### Get Logs
```bash
curl http://localhost:3000/logs/dshield-runtime
```

### Get Public Key (for verification)
```bash
curl http://localhost:3000/publicKey
```

### Health Check
```bash
curl http://localhost:3000/health
```

## Configuration

Create `dshield.config.json`:

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
      "timeout": 30000
    }
  ],
  "logStorage": {
    "type": "memory"
  },
  "signer": {
    "type": "ephemeral"
  }
}
```

## Verification

Users can verify D-Shield deployments by:

1. **Check attestation**: Verify the TEE attestation from Phala proves this exact code is running
2. **Audit logs**: Fetch and verify log signatures match the public key
3. **Verify sequences**: Ensure no gaps in log sequence numbers (detects deletions)

```javascript
import { verifyLogIntegrity } from 'dshield/log-store';
import { verifySignature } from 'dshield/signer';

const publicKey = await fetch('/publicKey').then(r => r.text());
const logs = await fetch('/logs/dshield-runtime').then(r => r.json());

const result = await verifyLogIntegrity(logs.entries, publicKey, verifySignature);
console.log('Logs valid:', result.valid);
```

## Client Code Transparency

D-Shield also supports client-side code transparency, allowing developers to cryptographically prove what code is running on client devices.

```bash
# Generate signing keys
npx dshield-sign keygen --output ./keys

# Generate manifest from build output
npx dshield-sign generate \
  --dir ./dist \
  --name "My App v1.0.0" \
  --type web \
  --egress api.myapp.com

# Sign the manifest
npx dshield-sign sign \
  --manifest manifest.json \
  --key keys/dshield-private.pem

# Publish to D-Shield server
npx dshield-sign publish \
  --manifest signed-manifest.json \
  --server https://your-dshield-server.com
```

See [docs/CLIENT-TRANSPARENCY.md](docs/CLIENT-TRANSPARENCY.md) for full documentation.

## License

MIT
