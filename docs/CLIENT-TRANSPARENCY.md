# Client Code Transparency

D-Shield's client transparency feature allows developers to cryptographically prove what code is running on client devices. Just as D-Shield's server-side egress attestation proves where your functions send data, client transparency proves what code your users are actually running.

## The Problem

Even with server-side attestation, users can't verify:
- What data the client collects before sending to the attested backend
- Whether the client sends data to unauthorized endpoints
- Whether the client code matches what was audited

## The Solution

Client transparency provides:
1. **Reproducible Build Manifests** - Hash every file in your build output
2. **Cryptographic Signing** - Sign manifests with RSA keys
3. **Published Registry** - Users can discover and verify manifests
4. **Self-Verification SDK** - Clients can verify their own integrity

## Quick Start

### 1. Generate Signing Keys

```bash
# Generate a new RSA-2048 key pair
npx dshield-sign keygen --output ./keys

# This creates:
#   keys/dshield-private.pem  (keep this secret!)
#   keys/dshield-public.pem   (publish this)
```

### 2. Generate a Manifest

After building your client application:

```bash
npx dshield-sign generate \
  --dir ./dist \
  --name "My App Web Client v1.0.0" \
  --type web \
  --egress api.myapp.com,cdn.myapp.com \
  --output manifest.json
```

### 3. Sign the Manifest

```bash
npx dshield-sign sign \
  --manifest manifest.json \
  --key keys/dshield-private.pem \
  --output signed-manifest.json
```

### 4. Publish to D-Shield Server

```bash
npx dshield-sign publish \
  --manifest signed-manifest.json \
  --server https://your-dshield-server.com
```

### 5. Verify (Optional)

```bash
npx dshield-sign verify \
  --manifest signed-manifest.json \
  --dir ./dist
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Sign Client

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Generate manifest
        run: |
          npx dshield-sign generate \
            --dir ./dist \
            --name "My App ${{ github.ref_name }}" \
            --type web \
            --egress api.myapp.com \
            --repo ${{ github.server_url }}/${{ github.repository }} \
            --commit ${{ github.sha }}

      - name: Sign manifest
        run: |
          echo "${{ secrets.DSHIELD_PRIVATE_KEY }}" > private.pem
          npx dshield-sign sign \
            --manifest manifest.json \
            --key private.pem
          rm private.pem

      - name: Publish manifest
        run: |
          npx dshield-sign publish \
            --manifest signed-manifest.json \
            --server ${{ secrets.DSHIELD_SERVER_URL }}
```

## Client-Side Verification

### Web Applications

Include the verification SDK in your web application:

```typescript
import { createWebVerifier } from '@dshield/client-transparency';

const verifier = createWebVerifier({
  serverUrl: 'https://your-dshield-server.com',
  trustedFingerprints: ['abc123...'], // Optional: your key fingerprint
});

// Self-verify on page load
async function verifySelf() {
  const result = await verifier.selfVerify('My App Web Client');

  if (!result.valid) {
    console.error('Client verification failed!', result.errors);
    // Show warning to user
    showSecurityWarning(result);
  } else {
    console.log('Client verified successfully');
    showSecurityBadge();
  }
}

// Quick hash check
async function checkBundleHash() {
  const hash = await verifier.computeCurrentBundleHash();
  const result = await verifier.checkBundleHash(hash);

  return result.trusted;
}
```

### Manual Verification

Users can verify any client by fetching and checking the manifest:

```typescript
import { createVerifier } from '@dshield/client-transparency';

const verifier = createVerifier({
  serverUrl: 'https://dshield.example.com',
});

// Get the latest manifest for a client
const manifest = await verifier.getLatestManifest('My App Web Client');

// Verify the signature
const signatureValid = await verifier.verifySignature(manifest);
console.log('Signature valid:', signatureValid);

// Check allowed egress
console.log('Allowed domains:', manifest.manifest.allowedEgress);
```

## API Reference

### Manifest Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/manifests` | Register a new signed manifest |
| `GET` | `/api/manifests` | List all registered manifests |
| `GET` | `/api/manifests/:id` | Get manifest by ID |
| `DELETE` | `/api/manifests/:id` | Delete a manifest |
| `POST` | `/api/manifests/verify` | Verify a manifest |
| `GET` | `/api/manifests/by-hash/:hash` | Get manifest by bundle hash |
| `GET` | `/api/manifests/latest/:name` | Get latest manifest for client |
| `GET` | `/api/manifests/chain/:id` | Get manifest version history |
| `POST` | `/api/manifests/check-hash` | Quick bundle hash verification |

### Register Manifest

```bash
curl -X POST https://dshield.example.com/api/manifests \
  -H "Content-Type: application/json" \
  -d '{
    "signedManifest": { ... },
    "setLatest": true
  }'
```

### Check Bundle Hash

```bash
curl -X POST https://dshield.example.com/api/manifests/check-hash \
  -H "Content-Type: application/json" \
  -d '{
    "bundleHash": "abc123...",
    "trustedFingerprints": ["fingerprint1"]
  }'
```

Response:
```json
{
  "trusted": true,
  "manifest": { ... }
}
```

## Manifest Structure

A signed client manifest contains:

```json
{
  "manifest": {
    "version": "1.0",
    "manifestId": "uuid",
    "name": "My App Web Client v1.0.0",
    "clientType": "web",
    "bundleHash": "sha256-of-all-file-hashes",
    "files": [
      {
        "path": "main.js",
        "hash": "sha256-of-file",
        "size": 12345,
        "mimeType": "application/javascript"
      }
    ],
    "build": {
      "gitCommit": "abc123",
      "gitBranch": "main",
      "buildTimestamp": "2024-01-01T00:00:00Z",
      "buildEnvironment": "github-actions"
    },
    "source": {
      "repositoryUrl": "https://github.com/org/repo",
      "commitHash": "abc123"
    },
    "allowedEgress": ["api.myapp.com", "cdn.myapp.com"],
    "dshieldFunctions": ["chat", "analyze"]
  },
  "signature": "base64-rsa-signature",
  "signedAt": "2024-01-01T00:00:00Z",
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "keyFingerprint": "sha256-of-public-key"
}
```

## Security Considerations

### Key Management

- **Never commit private keys** to version control
- Use CI/CD secrets for automated signing
- Consider key rotation policies
- Keep backup copies in secure storage

### Trust Model

The client transparency system provides:

1. **Code Authenticity** - Signature proves the manifest was created by the key holder
2. **Code Integrity** - Hash chain proves files haven't been modified
3. **Version Chain** - Previous manifest links prove upgrade history
4. **Egress Declaration** - Allowed domains are part of the signed manifest

It does NOT guarantee:
- That the source code is safe (still requires audits)
- That the build process wasn't compromised
- That the private key wasn't stolen

### Best Practices

1. **Reproducible Builds** - Ensure your builds are deterministic
2. **Source Links** - Include repository and commit hash for auditability
3. **Version Chains** - Maintain upgrade history for rollback detection
4. **Public Key Distribution** - Publish your public key in multiple locations
5. **Key Pinning** - Have users pin your key fingerprint

## Integration with D-Shield Functions

Link your client manifest to D-Shield functions:

```bash
npx dshield-sign generate \
  --dir ./dist \
  --name "My App" \
  --type web \
  --egress api.myapp.com \
  --functions chat,analyze,export
```

This creates a verifiable link between your client and server code, enabling end-to-end transparency.

## Troubleshooting

### "Bundle hash not registered"

The client's current code doesn't match any registered manifest. This could mean:
- A new version was deployed without publishing a manifest
- The build is different from the signed version
- Files were modified after signing

### "Invalid manifest signature"

The signature doesn't match the manifest content. This could indicate:
- Manifest was modified after signing
- Wrong public key used for verification
- Signature corruption

### "Manifest signed by untrusted key"

The manifest is valid but signed by a key not in your trusted list. Verify:
- The key fingerprint matches your expected key
- Update your trusted fingerprints if keys were rotated
