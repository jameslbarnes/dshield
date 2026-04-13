import { Link } from 'react-router-dom'
import { Shield, Settings } from 'lucide-react'
import './Docs.css'

export function Docs() {
  return (
    <div className="docs">
      <header className="header">
        <div className="header-left">
          <Link to="/" className="header-home">
            <Shield size={20} strokeWidth={2.5} />
            <span className="logo-text">Auditor</span>
          </Link>
        </div>
        <nav className="header-nav">
          <Link to="/docs">Docs</Link>
          <a href="https://github.com/jameslbarnes/auditor" target="_blank" rel="noopener">GitHub</a>
          <Link to="/admin" className="admin-link">
            <Settings size={16} />
            Admin
          </Link>
        </nav>
      </header>

      <main className="docs-main">
        <nav className="docs-nav">
          <h3>Getting Started</h3>
          <a href="#overview">Overview</a>
          <a href="#signup">Get an API key</a>
          <a href="#deploy">Deploy a function</a>
          <a href="#invoke">Invoke</a>
          <a href="#verify">Verify egress logs</a>

          <h3>Concepts</h3>
          <a href="#how-it-works">How it works</a>
          <a href="#attestation-chain">Chained attestation</a>
          <a href="#signatures">Signature verification</a>

          <h3>API Reference</h3>
          <a href="#api-signup">POST /api/signup</a>
          <a href="#api-functions">Functions</a>
          <a href="#api-invoke">POST /invoke/:id</a>
          <a href="#api-logs">GET /logs/:id</a>
          <a href="#api-keys">API Keys</a>
          <a href="#api-secrets">Secrets</a>

          <h3>Deployment</h3>
          <a href="#self-hosting">Self-hosting</a>
          <a href="#phala">Phala Cloud</a>
        </nav>

        <article className="docs-content">
          <section id="overview">
            <h1>Auditor Documentation</h1>
            <p>
              Auditor is a serverless runtime that runs your functions inside a trusted execution
              environment (TEE) and signs every outbound request. You keep your code private while
              proving exactly where user data goes.
            </p>
          </section>

          <section id="signup">
            <h2>Get an API key</h2>
            <p>Create an API key with a single request. Keys grant permission to deploy functions, invoke them, and read logs.</p>
            <pre><code>{`curl -X POST $AUDITOR_URL/api/signup \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Your Name", "appName": "my-app"}'`}</code></pre>
            <p>Response:</p>
            <pre><code>{`{
  "id": "a1b2c3d4",
  "name": "Your Name",
  "key": "auditor_abc123...",
  "permissions": ["functions:read", "functions:write", "functions:invoke"]
}`}</code></pre>
            <p><strong>Save your key.</strong> It is only shown once at creation time.</p>
          </section>

          <section id="deploy">
            <h2>Deploy a function</h2>
            <p>Functions are JavaScript (Node.js) or Python handlers. They run inside the TEE and all outbound HTTP requests are logged and signed.</p>
            <pre><code>{`curl -X POST $AUDITOR_URL/api/functions \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": "moderate",
    "name": "Content Moderator",
    "runtime": "node",
    "code": "export async function handler(req) {\\n  const res = await fetch(\\\"https://api.openai.com/v1/chat/completions\\\", {\\n    method: \\\"POST\\\",\\n    headers: { \\\"Authorization\\\": \\\"Bearer \\\" + process.env.OPENAI_KEY },\\n    body: JSON.stringify(req.body)\\n  });\\n  return { statusCode: 200, body: await res.json() };\\n}"
  }'`}</code></pre>
            <h3>Function format</h3>
            <p>Your function must export a <code>handler</code> function that receives a request object and returns a response:</p>
            <pre><code>{`// Node.js
export async function handler(request) {
  const { text } = request.body || {};

  // Any fetch() call is logged and signed by the TEE
  const response = await fetch("https://api.openai.com/...", {
    method: "POST",
    headers: { "Authorization": "Bearer " + process.env.API_KEY },
    body: JSON.stringify({ prompt: text })
  });

  const data = await response.json();
  return { statusCode: 200, body: data };
}`}</code></pre>
            <h3>Environment variables</h3>
            <p>Functions can access environment variables set at the runtime level (via the deployment compose file) or secrets stored via the Secrets API.</p>
          </section>

          <section id="invoke">
            <h2>Invoke a function</h2>
            <pre><code>{`curl -X POST $AUDITOR_URL/invoke/moderate \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "content to moderate"}'`}</code></pre>
            <p>The response is whatever your function returns. Every outbound request made during execution is logged.</p>
          </section>

          <section id="verify">
            <h2>Verify egress logs</h2>
            <p>Logs are public. Anyone can fetch them:</p>
            <pre><code>{`curl $AUDITOR_URL/logs/moderate`}</code></pre>
            <p>Response:</p>
            <pre><code>{`{
  "functionId": "moderate",
  "count": 3,
  "entries": [
    {
      "sequence": 1,
      "host": "cloud-api.near.ai",
      "path": "/v1/chat/completions",
      "method": "POST",
      "protocol": "https",
      "source": "tee",
      "destinationAttestation": "https://cloud-api.near.ai/v1/attestation/report",
      "signature": "RSA-2048 signature..."
    }
  ],
  "publicKey": "-----BEGIN PUBLIC KEY-----\\n..."
}`}</code></pre>
            <p>Each entry is signed by the TEE's RSA key. The public key is included in the response and tied to the TEE's hardware attestation.</p>
            <h3>What to check</h3>
            <ul>
              <li><strong>Hosts</strong> — does the function only talk to expected endpoints?</li>
              <li><strong>Sequences</strong> — are they continuous? A gap means entries were deleted (tampering).</li>
              <li><strong>Signatures</strong> — do they verify against the public key?</li>
              <li><strong>Destination attestation</strong> — if present, the destination is also running in a TEE.</li>
            </ul>
          </section>

          <section id="how-it-works">
            <h2>How it works</h2>
            <p>Auditor runs on <a href="https://phala.network" target="_blank" rel="noopener">Phala Network</a> using Intel TDX (Trusted Domain Extensions). The architecture:</p>
            <ol>
              <li>Your function code is deployed via the API and stored in TEE-encrypted persistent storage</li>
              <li>When invoked, the function runs in an isolated subprocess inside the TEE</li>
              <li>All outbound HTTP/HTTPS requests are routed through a logging proxy</li>
              <li>The proxy signs each log entry with an RSA key held inside the TEE</li>
              <li>Signed logs are stored and publicly accessible via the logs endpoint</li>
            </ol>
            <p>The TEE guarantees that the logging proxy code is genuine (via remote attestation) and that the signing key never leaves the enclave. The operator cannot modify the logs or forge signatures.</p>
          </section>

          <section id="attestation-chain">
            <h2>Chained attestation</h2>
            <p>When your function calls an API that also runs in a TEE (like Near AI's private inference), Auditor includes a <code>destinationAttestation</code> field in the log entry linking to the destination's own attestation report.</p>
            <p>This creates a chain of trust: your data went from a verified TEE (Auditor) to another verified TEE (the inference provider). Both sides are independently attestable.</p>
            <p>Currently supported attested destinations:</p>
            <ul>
              <li><code>cloud-api.near.ai</code> — <a href="https://cloud-api.near.ai/v1/attestation/report" target="_blank" rel="noopener">Near AI Private Inference</a> (Intel TDX + NVIDIA CC)</li>
            </ul>
            <p>To add more attested destinations, update the <code>ATTESTED_DESTINATIONS</code> map in the server source.</p>
          </section>

          <section id="signatures">
            <h2>Signature verification</h2>
            <p>Each log entry is signed with SHA-256 + RSA-2048. To verify:</p>
            <ol>
              <li>Remove the <code>signature</code> field from the entry</li>
              <li>Serialize the remaining fields as compact JSON (<code>JSON.stringify</code> with no whitespace)</li>
              <li>Verify the signature against the public key using PKCS1v15 padding</li>
            </ol>
            <pre><code>{`import base64, json
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

logs = fetch_logs()  # GET /logs/moderate
pub_key = serialization.load_pem_public_key(logs["publicKey"].encode())

for entry in logs["entries"]:
    sig = base64.b64decode(entry.pop("signature"))
    data = json.dumps(entry, separators=(',', ':'))
    pub_key.verify(sig, data.encode(), padding.PKCS1v15(), hashes.SHA256())
    print(f"#{entry['sequence']} {entry['host']} verified")`}</code></pre>
          </section>

          <section id="api-signup">
            <h2>POST /api/signup</h2>
            <p>Public endpoint. Creates an API key with <code>functions:read</code>, <code>functions:write</code>, and <code>functions:invoke</code> permissions.</p>
            <h3>Request</h3>
            <pre><code>{`{
  "name": "string (required)",
  "appName": "string (required)"
}`}</code></pre>
            <h3>Response (201)</h3>
            <pre><code>{`{
  "id": "string",
  "name": "string",
  "key": "string (save this — shown only once)",
  "permissions": ["functions:read", "functions:write", "functions:invoke"]
}`}</code></pre>
          </section>

          <section id="api-functions">
            <h2>Functions API</h2>
            <p>All function endpoints require <code>Authorization: Bearer $API_KEY</code>.</p>

            <h3>POST /api/functions</h3>
            <pre><code>{`{
  "id": "string (required, URL-safe)",
  "name": "string (required)",
  "runtime": "node" | "python",
  "code": "string (required, plain text or base64)",
  "handler": "string (default: 'handler')",
  "timeout": number (default: 30000, milliseconds)
}`}</code></pre>

            <h3>GET /api/functions</h3>
            <p>List all functions (code omitted from response).</p>

            <h3>GET /api/functions/:id</h3>
            <p>Get function details including code.</p>

            <h3>PUT /api/functions/:id</h3>
            <p>Update a function's code, name, or timeout.</p>

            <h3>DELETE /api/functions/:id</h3>
            <p>Delete a function and its logs.</p>
          </section>

          <section id="api-invoke">
            <h2>POST /invoke/:id</h2>
            <p>Requires <code>Authorization: Bearer $API_KEY</code> with <code>functions:invoke</code> permission.</p>
            <p>The request body is passed to your function as <code>request.body</code>. The response is your function's return value.</p>
            <p>Response headers include:</p>
            <ul>
              <li><code>X-DShield-Invocation-Id</code> — unique ID for this invocation</li>
              <li><code>X-DShield-Duration-Ms</code> — execution time</li>
            </ul>
          </section>

          <section id="api-logs">
            <h2>GET /logs/:id</h2>
            <p>Public endpoint. Returns all signed egress log entries for a function.</p>
            <p>Response includes the TEE public key for signature verification.</p>
          </section>

          <section id="api-keys">
            <h2>API Keys</h2>
            <p>Requires admin-level API key.</p>
            <ul>
              <li><code>POST /api/keys</code> — create a key with specific permissions</li>
              <li><code>GET /api/keys</code> — list all keys</li>
              <li><code>DELETE /api/keys/:id</code> — delete a key</li>
            </ul>
            <h3>Permissions</h3>
            <ul>
              <li><code>admin</code> — full access</li>
              <li><code>functions:read</code> — list and get functions</li>
              <li><code>functions:write</code> — create, update, delete functions</li>
              <li><code>functions:invoke</code> — invoke functions</li>
              <li><code>secrets:read</code> — list secret names</li>
              <li><code>secrets:write</code> — create and delete secrets</li>
            </ul>
          </section>

          <section id="api-secrets">
            <h2>Secrets</h2>
            <p>Requires admin-level API key with <code>secrets:write</code> permission.</p>
            <ul>
              <li><code>POST /api/secrets</code> — store a secret (encrypted at rest in the TEE)</li>
              <li><code>GET /api/secrets</code> — list secret names (values are never returned)</li>
              <li><code>DELETE /api/secrets/:name</code> — delete a secret</li>
            </ul>
            <p>Secrets are available to functions as environment variables.</p>
          </section>

          <section id="self-hosting">
            <h2>Self-hosting</h2>
            <pre><code>{`# Build the image
docker build -t yourname/auditor:latest .

# Run locally (no TEE — signatures use ephemeral keys)
docker run -p 3000:3000 \\
  -e DSHIELD_ROOT_KEY=$(openssl rand -hex 32) \\
  yourname/auditor:latest

# The root key is printed at startup — save it for admin access`}</code></pre>
            <p>Locally, functions run without TEE isolation. Signatures use ephemeral RSA keys (valid for the lifetime of the process). For production TEE attestation, deploy to Phala Cloud.</p>
          </section>

          <section id="phala">
            <h2>Phala Cloud deployment</h2>
            <p>Phala Cloud runs your container inside an Intel TDX confidential VM. The signing key is derived from the TEE hardware and the attestation is verifiable via Intel's root of trust.</p>
            <ol>
              <li>Push your image to Docker Hub</li>
              <li>Create a <code>docker-compose.yml</code> referencing the image</li>
              <li>Set environment variables in Phala's encrypted env file:
                <pre><code>{`DSHIELD_ROOT_KEY=your_root_key
AUDITOR_ENCRYPTION_KEY=your_encryption_key
# Plus any secrets your functions need`}</code></pre>
              </li>
              <li>Deploy via the Phala dashboard or CLI</li>
            </ol>
            <p><strong>Important:</strong> Set <code>AUDITOR_ENCRYPTION_KEY</code> to a stable value. This ensures persistent storage survives CVM restarts. Without it, the TEE derives a key that may change across restarts.</p>
          </section>
        </article>
      </main>
    </div>
  )
}
