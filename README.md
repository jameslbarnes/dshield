# Auditor

**Verifiable egress for AI agents.**

Auditor lets users (and other AI agents) answer a simple question: *where does this agent send my data?*

## The Problem

AI agents are black boxes. They take your data—conversations, documents, credentials—and do things with it. Users have no way to verify claims like:
- "We only send data to OpenAI"
- "We don't share your information with third parties"
- "We can't see your data—it's processed in a TEE"

This is a trust problem at two levels:
- **User → Agent:** Should I give this agent my data?
- **Agent → Agent:** Should my agent delegate tasks to another agent?

## The Solution

Auditor provides verifiable egress logging at two layers:

### 1. Server-Side: TEE-Attested Functions

Run your backend code inside a Trusted Execution Environment (TEE) on Phala Network. Every outbound HTTP request is logged and cryptographically signed—without requiring you to open-source your code.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Phala CVM (TDX TEE)                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Your Function (proprietary)                                ││
│  │       │                                                     ││
│  │       ▼                                                     ││
│  │  ┌─────────────────────────────────────────────────────┐   ││
│  │  │  Logging Proxy (open source, TEE-measured)          │   ││
│  │  │  Logs: method, URL, host, status, timing            │   ││
│  │  │  Signs each entry with TEE-held keys                │   ││
│  │  └─────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**What you get:** Cryptographic proof of every external service your backend contacts—API providers, databases, analytics, etc.

### 2. Client-Side: Browser Egress SDK

A JavaScript SDK that intercepts `fetch`, `XMLHttpRequest`, and `WebSocket` connections in the browser, reporting where the client sends data.

```javascript
import { AuditorSDK } from '@auditor/client-sdk';

AuditorSDK.init({ appId: 'my-app' });
// Now all browser network requests are logged
```

**Current limitation:** Client-side logs are self-reported. However, anyone can verify them using browser DevTools—the SDK doesn't claim to prove anything users can't check themselves.

### 3. The Report Card

The combination of server-side TEE attestation and client-side reporting creates a structured report:

```
GET /report/my-app.json

{
  "app": "my-app",
  "server": {
    "attested": true,
    "tee": "Intel TDX via Phala Network",
    "egress": [
      {"host": "api.anthropic.com", "purpose": "LLM inference"},
      {"host": "firestore.googleapis.com", "purpose": "storage"}
    ]
  },
  "client": {
    "attested": false,
    "note": "Self-reported, verifiable via browser DevTools",
    "egress": [
      {"host": "my-app.com", "purpose": "API server"},
      {"host": "cdn.jsdelivr.net", "purpose": "libraries"}
    ]
  },
  "not_observed": ["analytics", "ad networks", "data brokers"]
}
```

**Why this matters:**
- **For users:** Before trusting an AI agent with sensitive data, check its report card
- **For AI agents:** When delegating tasks to another agent, programmatically verify its data practices
- **Machine-readable:** JSON format enables automated trust decisions

## Example: ETHEREA

ETHEREA is a creative AI tool that uses Auditor to prove its data practices:

**Server-side (TEE-attested):**
- AI responses → `api.anthropic.com`, `openrouter.ai`
- Transcription → `api.deepgram.com`
- Storage → `firestore.googleapis.com`

**Client-side (self-reported):**
- App server → `etherea.app`
- Libraries → `cdn.jsdelivr.net`

Users see exactly where their voice data and AI conversations go—no hidden analytics, no data brokers.

## Current Status

| Component | Status |
|-----------|--------|
| TEE serverless runtime | Working (deployed on Phala) |
| Python/Node.js function support | Working |
| Encrypted persistent storage | Working |
| Management API (secrets, functions, logs) | Working |
| Client SDK | Working (self-reported) |
| Report card endpoint | Scaffolding |
| Field-level logging | Planned |

## Quick Start

### Deploy a Function

```bash
# 1. Build and push
docker build -t yourname/auditor:latest .
docker push yourname/auditor:latest

# 2. Deploy to Phala Cloud with ROOT_ENCRYPTION_KEY env var

# 3. Add secrets
curl -X POST $AUDITOR_URL/api/secrets \
  -H "Authorization: Bearer $ROOT_KEY" \
  -d '{"name": "API_KEY", "value": "sk-..."}'

# 4. Deploy function (base64-encoded code)
curl -X POST $AUDITOR_URL/api/functions \
  -H "Authorization: Bearer $ROOT_KEY" \
  -d '{"id": "my-func", "runtime": "python", "code": "<base64>", "handler": "handler"}'

# 5. Invoke
curl -X POST $AUDITOR_URL/invoke/my-func -d '{"input": "data"}'

# 6. Check logs
curl $AUDITOR_URL/api/logs/my-func -H "Authorization: Bearer $ROOT_KEY"
```

### Add Client SDK

```html
<script src="https://unpkg.com/@auditor/client-sdk"></script>
<script>
  AuditorSDK.init({ appId: 'my-app', reportUrl: 'https://my-auditor.phala.network' });
</script>
```

## Why Not Just Open Source?

You could open-source your code and let people verify it. But:

1. **Proprietary logic:** Many businesses can't or won't open-source their code
2. **Verification burden:** Users can't realistically audit every codebase they interact with
3. **Runtime guarantees:** Open source proves what code *could* do, not what it *is* doing

Auditor provides runtime proof of behavior without requiring code disclosure.

## Roadmap

- [ ] Field-level logging (see exactly which fields are written to databases)
- [ ] Encryption detection (flag which fields appear encrypted)
- [ ] Report card UI
- [ ] MCP server (let AI assistants query report cards directly)
- [ ] Agent-to-agent trust protocol
- [ ] Client SDK hardening

## License

MIT
