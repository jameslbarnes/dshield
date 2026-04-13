# Auditor

**Prove who your agent talks to.**

Auditor runs your functions inside a trusted execution environment and signs every outbound request, so you can keep your code private while proving exactly where user data goes.

## How it works

```
┌──────────────────────────────────────────────┐
│           Phala CVM (Intel TDX)              │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Your Function (proprietary code)      │  │
│  │       │                                │  │
│  │       ▼                                │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │  Logging Proxy (open source)     │  │  │
│  │  │  Signs each request with TEE key │  │  │
│  │  └──────────────────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

Every outbound request your function makes is logged, signed, and publicly verifiable. The hardware guarantees the logs are real.

## Get started with three API calls

### 1. Get an API key

```bash
curl -X POST $AUDITOR_URL/api/signup \
  -H "Content-Type: application/json" \
  -d '{"name": "Your Name", "appName": "my-app"}'
```

### 2. Deploy a function

```bash
curl -X POST $AUDITOR_URL/api/functions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "moderate",
    "runtime": "node",
    "code": "export async function handler(req) {
      const result = await fetch(\"https://api.openai.com/...\")
      return { statusCode: 200, body: result }
    }"
  }'
```

### 3. Invoke and verify

```bash
# Invoke
curl -X POST $AUDITOR_URL/invoke/moderate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "user content"}'

# Check the signed egress logs
curl $AUDITOR_URL/logs/moderate
```

The logs show every outbound request, signed by the TEE:

```json
{
  "entries": [
    {
      "sequence": 1,
      "host": "cloud-api.near.ai",
      "path": "/v1/chat/completions",
      "method": "POST",
      "source": "tee",
      "destinationAttestation": "https://cloud-api.near.ai/v1/attestation/report",
      "signature": "RSA-2048..."
    }
  ]
}
```

When the destination is itself a TEE (like Near AI), Auditor chains the attestations — the `destinationAttestation` field links to the destination's own TEE report.

## In production

Auditor powers content moderation for [Teleport Router](https://hermes.teleport.computer), an open-source AI notebook.

- The moderation prompt is private so it resists gaming
- Egress logs prove the moderator only talks to Near AI's LLM API
- Near AI also runs in a TEE — full chain of trust
- The rest of the application stays fully open source

This pattern — open-source app with private attested plugins — generalizes to any application that needs proprietary logic with verifiable data handling.

## What you can build

- **Content moderation** — Private rules that resist gaming, with proof the content was evaluated and forgotten
- **Medical triage** — Patients describe symptoms and get guidance, with proof their data only reached the LLM
- **Financial advice** — Users share sensitive financials for personalized recommendations the agent provably forgets
- **Hiring screens** — AI evaluates candidates with proprietary criteria and proves it only returned a score
- **Open-source routing** — Public applications delegate sensitive operations to private attested functions
- **Credential delegation** — Agents borrow your API keys for a task and prove they only called authorized endpoints

## API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/signup` | Public | Get an API key |
| `POST /api/functions` | Bearer | Deploy a function |
| `GET /api/functions` | Bearer | List functions |
| `PUT /api/functions/:id` | Bearer | Update a function |
| `DELETE /api/functions/:id` | Bearer | Delete a function |
| `POST /invoke/:id` | Bearer | Invoke a function |
| `GET /logs/:id` | Public | Get signed egress logs |
| `GET /publicKey` | Public | Get TEE public key |
| `GET /health` | Public | Health check |

## Deploy your own

```bash
# Build
docker build -t yourname/auditor:latest .

# Run locally
docker run -p 3000:3000 \
  -e DSHIELD_ROOT_KEY=$(openssl rand -hex 32) \
  yourname/auditor:latest

# Deploy to Phala Cloud for TEE attestation
# See docs/DEPLOYMENT.md
```

## Verify log signatures

```python
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
import base64, json, urllib.request

logs = json.loads(urllib.request.urlopen(f"{AUDITOR_URL}/logs/moderate").read())
public_key = serialization.load_pem_public_key(logs["publicKey"].encode())

for entry in logs["entries"]:
    sig = base64.b64decode(entry.pop("signature"))
    data = json.dumps(entry, separators=(',', ':'))
    public_key.verify(sig, data.encode(), padding.PKCS1v15(), hashes.SHA256())
    entry["signature"] = base64.b64encode(sig).decode()
    print(f"#{entry['sequence']} {entry['host']} ✓")
```

## License

MIT
