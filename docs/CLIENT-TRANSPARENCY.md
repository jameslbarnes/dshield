# Client Code Transparency

D-Shield's client transparency feature allows developers to cryptographically prove what code is running on client devices. Just as D-Shield's server-side egress attestation proves where your functions send data, client transparency proves what code your users are actually running.

## The Problem

Even with server-side attestation, users can't verify:
- What data the client collects before sending to the attested backend
- Whether the client sends data to unauthorized endpoints
- Whether the client code matches what was audited

## The Solution: Transparent Fetch SDK

The simplest and most effective approach is the **Transparent Fetch SDK**. This SDK routes ALL client network requests through D-Shield, ensuring complete visibility into client-side data flows.

### How It Works

1. **Include the SDK** - Bundle the D-Shield client SDK in your app
2. **TEE Verification** - The TEE verifies the SDK hash in your manifest
3. **All Requests Logged** - Every fetch() call is proxied through D-Shield and logged with cryptographic signatures
4. **Complete Transparency** - Users can see exactly what data the client sends

### Quick Start with Transparent SDK

```typescript
import { initDShield } from '@dshield/client';

// Initialize once at app startup
initDShield({
  serverUrl: 'https://your-dshield-server.com',
  clientId: 'my-app-v1.0.0',
  debug: true,
});

// Now ALL fetch() calls are automatically proxied through D-Shield
const response = await fetch('https://api.example.com/data');
// This request is logged with signatures in the TEE
```

### SDK Features

- **Automatic Fetch Wrapping** - Global `fetch()` is replaced with a proxied version
- **Request Logging** - All requests are logged with cryptographic signatures
- **SDK Hash Verification** - TEE verifies the SDK hash matches the signed manifest
- **Exclude Paths** - Optionally exclude local assets from proxying
- **Non-Invasive** - Use `createDShieldFetch()` if you prefer not to modify global fetch

### Alternative: API Surface Documentation

For additional transparency, you can also document your API surface (endpoints, data categories, third-party services). This is optional but recommended for complete disclosure.

## Build Verification

In addition to the transparent SDK, D-Shield provides:
1. **Reproducible Build Manifests** - Hash every file in your build output
2. **Cryptographic Signing** - Sign manifests with RSA keys
3. **Published Registry** - Users can discover and verify manifests
4. **Self-Verification** - Clients can verify their own integrity

## SDK Verification in Manifest

When your build includes the D-Shield SDK, it's automatically detected and added to the manifest:

```json
{
  "manifest": {
    "...": "...",
    "sdkVerification": {
      "sdkId": "dshield-client-sdk",
      "sdkVersion": "1.0.0",
      "sdkHash": "sha256-of-sdk-file",
      "sdkPath": "dist/dshield-sdk.js"
    }
  }
}
```

The TEE verifies:
1. The SDK file exists at the specified path
2. The SDK hash matches the signed manifest
3. The SDK version is compatible

This ensures all client requests go through D-Shield's logging proxy.

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

## API Surface Documentation

The key feature of client transparency is documenting **every API endpoint** your client communicates with. This lets users see exactly what data flows where.

### Automatic API Discovery

Scan your source code to automatically discover API calls:

```bash
npx dshield-sign analyze \
  --dir ./src \
  --output api-surface.json \
  --report
```

This will:
1. Scan all JavaScript/TypeScript files
2. Detect `fetch()`, `axios`, `XMLHttpRequest`, and `WebSocket` calls
3. Extract URLs and HTTP methods
4. Generate a template `api-surface.json`
5. Create a markdown report for review

### API Surface Structure

The API surface documents:

```json
{
  "version": "1.0",
  "generatedAt": "2024-01-01T00:00:00Z",
  "endpoints": [
    {
      "id": "user-auth",
      "name": "User Authentication",
      "baseUrl": "https://api.myapp.com",
      "path": "/v1/auth/login",
      "methods": ["POST"],
      "purpose": "Authenticate users with email/password",
      "dataSent": {
        "description": "User credentials",
        "categories": ["credentials"],
        "containsPii": true
      },
      "dataReceived": {
        "description": "JWT access token and user profile",
        "categories": ["credentials", "identifiers"]
      },
      "required": true,
      "authentication": "none",
      "dshieldFunctionId": "auth-proxy"
    },
    {
      "id": "chat-api",
      "name": "AI Chat",
      "baseUrl": "https://api.myapp.com",
      "path": "/v1/chat",
      "methods": ["POST"],
      "purpose": "Send messages to AI assistant",
      "dataSent": {
        "description": "User messages and conversation context",
        "categories": ["user-input", "communications"]
      },
      "dataReceived": {
        "description": "AI-generated responses",
        "categories": ["communications"]
      },
      "required": true,
      "authentication": "bearer",
      "dshieldFunctionId": "chat"
    }
  ],
  "thirdPartyServices": [
    {
      "name": "Google Analytics",
      "category": "analytics",
      "domains": ["www.google-analytics.com"],
      "purpose": "Usage analytics and metrics",
      "privacyPolicyUrl": "https://policies.google.com/privacy",
      "optional": true
    }
  ],
  "websockets": [
    {
      "id": "realtime",
      "url": "wss://api.myapp.com/ws",
      "purpose": "Real-time message updates"
    }
  ],
  "localStorage": [
    {
      "key": "auth_token",
      "purpose": "Store authentication token",
      "categories": ["credentials"],
      "storageType": "localStorage"
    }
  ],
  "cookies": [
    {
      "name": "session_id",
      "purpose": "Session tracking",
      "type": "essential",
      "party": "first",
      "expiration": "session"
    }
  ]
}
```

### Data Categories

The `categories` field uses standardized data types:

| Category | Description |
|----------|-------------|
| `user-input` | Direct user input (messages, forms) |
| `credentials` | Auth tokens, passwords, API keys |
| `analytics` | Usage metrics, telemetry |
| `device-info` | Device/browser metadata |
| `location` | Geographic data |
| `media` | Images, audio, video |
| `files` | User files/documents |
| `preferences` | User settings |
| `identifiers` | User IDs, session IDs |
| `financial` | Payment info |
| `health` | Health/medical data |
| `communications` | Messages, emails |
| `behavioral` | Click patterns, interactions |
| `third-party` | Data from other services |
| `system` | App state, errors, logs |

### Including API Surface in Manifest

After reviewing and editing the generated API surface:

```bash
npx dshield-sign generate \
  --dir ./dist \
  --name "My App v1.0.0" \
  --type web \
  --egress api.myapp.com,www.google-analytics.com \
  --api-surface api-surface.json
```

The `allowedEgress` domains should match the domains in your API surface.

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
