import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Shield, CheckCircle2, ArrowRight, Lock, FileCode, Settings } from 'lucide-react'
import './Landing.css'

const API_BASE = ''

interface LogEntry {
  timestamp: string
  method: string
  host: string
  path: string
  protocol: string
  functionId: string
  appName?: string
  invocationId: string
  sequence: number
  signature: string
  source?: 'tee' | 'client'
  initiator?: string
  destinationAttestation?: string
  dbWrite?: {
    provider: string
    fields: string[]
    collection?: string
  }
}

interface LogsResponse {
  entries: LogEntry[]
  publicKey: string
}

function SignupForm() {
  const [name, setName] = useState('')
  const [appName, setAppName] = useState('')
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, appName }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Signup failed')
      }
      const data = await res.json()
      setApiKey(data.key)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  if (apiKey) {
    return (
      <div className="signup-result">
        <p className="signup-success">Your API key (save this, shown only once):</p>
        <pre className="code-block"><code>{apiKey}</code></pre>
        <div className="signup-next">
          <p>Deploy a function:</p>
          <pre className="code-block"><code>{`curl -X POST ${window.location.origin}/api/functions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"id": "my-func", "runtime": "node", "code": "..."}'`}</code></pre>
        </div>
      </div>
    )
  }

  return (
    <form className="signup-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={e => setName(e.target.value)}
        required
      />
      <input
        type="text"
        placeholder="App or project name"
        value={appName}
        onChange={e => setAppName(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating...' : 'Get API Key'}
        {!submitting && <ArrowRight size={14} />}
      </button>
      {error && <p className="signup-error">{error}</p>}
    </form>
  )
}

export function Landing() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const fetchLogs = async () => {
    try {
      const fnRes = await fetch(`${API_BASE}/functions`)
      if (!fnRes.ok) throw new Error('Failed to fetch functions')
      const fnData = await fnRes.json()

      const allLogs: LogEntry[] = []
      for (const fn of fnData.functions || []) {
        try {
          const logRes = await fetch(`${API_BASE}/logs/${fn.id}`)
          if (logRes.ok) {
            const logData: LogsResponse = await logRes.json()
            allLogs.push(...logData.entries.map(e => ({
              ...e,
              source: e.source || 'tee' as const
            })))
          }
        } catch {
          // Skip failed log fetches
        }
      }

      allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      setLogs(allLogs)
      setLastUpdate(new Date())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
    const interval = setInterval(fetchLogs, 5000)
    return () => clearInterval(interval)
  }, [])

  const formatDestination = (log: LogEntry) => {
    return `${log.host}${log.path}`
  }

  return (
    <div className="landing">
      <header className="header">
        <div className="header-left">
          <Shield size={20} strokeWidth={2.5} />
          <span className="logo-text">Auditor</span>
        </div>
        <nav className="header-nav">
          <a href="https://github.com/jameslbarnes/auditor" target="_blank" rel="noopener">
            GitHub
          </a>
          <a href="https://docs.phala.com/dstack" target="_blank" rel="noopener">
            Docs
          </a>
          <Link to="/admin" className="admin-link">
            <Settings size={16} />
            Admin
          </Link>
        </nav>
      </header>

      <main className="main">
        <section className="hero">
          <p className="hero-eyebrow">Verifiable privacy for AI agents</p>
          <h1>Prove who your<br/>agent talks to.</h1>
          <p className="subtitle">
            Auditor runs your functions inside a trusted execution environment and signs every outbound request, so you can keep your code private while proving exactly where user data goes.
          </p>
        </section>

        <section className="solution">
          <h2>Get started with three API calls</h2>
          <SignupForm />
        </section>

        <section className="code-steps">
          <div className="code-step">
            <span className="step-number">1</span>
            <div className="step-content">
              <h3>Deploy</h3>
              <p>Push your function code. It runs inside the TEE.</p>
              <pre className="code-block"><code><span className="c-method">POST</span> /api/functions{'\n'}<span className="c-key">id:</span> <span className="c-str">"moderate"</span>  <span className="c-key">runtime:</span> <span className="c-str">"node"</span>{'\n'}<span className="c-key">code:</span> <span className="c-str">"export async function handler(req) {'{ ... }'}"</span></code></pre>
            </div>
          </div>
          <div className="code-step">
            <span className="step-number">2</span>
            <div className="step-content">
              <h3>Invoke</h3>
              <p>Call your function. Auditor logs every outbound request it makes.</p>
              <pre className="code-block"><code><span className="c-method">POST</span> /invoke/moderate{'\n'}<span className="c-key">body:</span> {'{ '}<span className="c-str">"text"</span>: <span className="c-str">"user content"</span>{' }'}{'\n'}{'\n'}<span className="c-comment">{'\u2192'} {'{ '}"verdict": "PASS"{' }'}</span></code></pre>
            </div>
          </div>
          <div className="code-step">
            <span className="step-number">3</span>
            <div className="step-content">
              <h3>Verify</h3>
              <p>Point humans and their agents to exactly where their data went.</p>
              <pre className="code-block"><code><span className="c-method">GET</span> /logs/moderate{'\n'}{'\n'}<span className="c-comment">sequence 1</span>  <span className="c-key">host:</span> <span className="c-str">api.openai.com</span>      <span className="c-sig">{'\u2713'} signed</span>{'\n'}<span className="c-comment">sequence 2</span>  <span className="c-key">host:</span> <span className="c-str">cloud-api.near.ai</span>  <span className="c-sig">{'\u2713'} signed</span>{'\n'}            <span className="c-key">destinationAttestation:</span> <a href="https://cloud-api.near.ai/v1/attestation/report" target="_blank" rel="noopener" className="c-link">near.ai/attestation</a>{'\n'}{'\n'}<span className="c-comment">Two calls. Near is also in a TEE — full chain of trust.</span></code></pre>
            </div>
          </div>
        </section>

        <section className="pillars">
          <div className="pillar server-pillar">
            <div className="pillar-icon">
              <Lock size={24} />
            </div>
            <h2>Hardware-backed</h2>
            <span className="pillar-badge tee">TEE-Attested</span>
            <p className="pillar-desc">
              Your function runs inside a trusted execution environment. Every outbound request gets cryptographically signed. <strong>The hardware guarantees the logs are real.</strong>
            </p>
            <ul className="pillar-features">
              <li><CheckCircle2 size={14} /> Hardware-enforced isolation</li>
              <li><CheckCircle2 size={14} /> Tamper-proof egress logs</li>
              <li><CheckCircle2 size={14} /> Verifiable attestation chain</li>
            </ul>
          </div>

          <div className="pillar client-pillar">
            <div className="pillar-icon">
              <CheckCircle2 size={24} />
            </div>
            <h2>Publicly verifiable</h2>
            <span className="pillar-badge client">Open Logs</span>
            <p className="pillar-desc">
              Egress logs are public and signed. Anyone can verify your agent only talked to the APIs it claims. <strong>Trust through math.</strong>
            </p>
            <ul className="pillar-features">
              <li><CheckCircle2 size={14} /> RSA-signed log entries</li>
              <li><CheckCircle2 size={14} /> Sequence-numbered (gap = tampering)</li>
              <li><CheckCircle2 size={14} /> Public key from TEE attestation</li>
            </ul>
          </div>
        </section>

        <div className="report-cta">
          <Link to="/report/demo" className="report-link">
            <FileCode size={16} />
            View Example Report
          </Link>
        </div>

        <section className="use-cases">
          <h2>What you can build</h2>
          <div className="use-case-grid">
            <div className="use-case">
              <h3>Content moderation</h3>
              <p>Private rules that resist gaming, with proof the content was evaluated and forgotten. <a href="https://hermes.teleport.computer" target="_blank" rel="noopener">Live on Teleport Router.</a></p>
            </div>
            <div className="use-case">
              <h3>Medical triage</h3>
              <p>Patients describe symptoms and get guidance, with proof their data only reached the LLM.</p>
            </div>
            <div className="use-case">
              <h3>Financial advice</h3>
              <p>Users share sensitive financials for personalized recommendations the agent provably forgets.</p>
            </div>
            <div className="use-case">
              <h3>Hiring screens</h3>
              <p>AI evaluates candidates with proprietary criteria and proves it only returned a score.</p>
            </div>
            <div className="use-case">
              <h3>Open-source routing</h3>
              <p>Public applications delegate sensitive operations to private attested functions with proven boundaries.</p>
            </div>
            <div className="use-case">
              <h3>Credential delegation</h3>
              <p>Agents borrow your API keys for a task and prove they only called authorized endpoints.</p>
            </div>
          </div>
        </section>

        <section className="live-feed">
          <div className="feed-header">
            <div className="feed-title">
              <div className={`live-indicator ${loading ? 'loading' : ''}`} />
              <span>Live Egress Log</span>
            </div>
            {lastUpdate && (
              <span className="last-update">
                Updated {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>

          <div className="feed-container">
            {error ? (
              <div className="feed-error">
                <p>Unable to connect to Auditor runtime</p>
                <code>{error}</code>
              </div>
            ) : logs.length === 0 ? (
              <div className="feed-empty">
                <p>Waiting for function invocations.</p>
              </div>
            ) : (
              <div className="feed-logs">
                <div className="feed-logs-header">
                  <span className="col-time">Time</span>
                  <span className="col-fn">Function</span>
                  <span className="col-method">Method</span>
                  <span className="col-url">Destination</span>
                  <span className="col-sig">Verified</span>
                </div>
                {logs.slice(0, 50).map((log, i) => (
                  <div key={`${log.sequence}-${i}`} className="log-entry tee-log">
                    <span className="col-time mono">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className="col-fn mono">{log.functionId}</span>
                    <span className={`col-method method-${log.method.toLowerCase()}`}>{log.method}</span>
                    <span className="col-url">
                      <span className="mono url-text">{formatDestination(log)}</span>
                      {log.destinationAttestation ? (
                        <a href={log.destinationAttestation} target="_blank" rel="noopener" className="dest-attested" title="Destination is also TEE-attested">
                          <Lock size={12} />
                          TEE
                        </a>
                      ) : null}
                    </span>
                    <span className="col-sig">
                      <span title="Cryptographically signed">
                        <CheckCircle2 size={14} className="sig-icon" />
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

      </main>

      <footer className="footer">
        <div className="powered-by">
          <span>Powered by</span>
          <a href="https://docs.phala.com/dstack" target="_blank" rel="noopener" className="dstack-badge">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="6" fill="#93c606"/>
              <path d="M8 12h16M8 16h12M8 20h8" stroke="#0A0F0C" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            d-stack
          </a>
        </div>
        <div className="footer-links">
          <a href={`${API_BASE}/publicKey`} target="_blank" rel="noopener">Public Key</a>
          <span className="footer-divider">·</span>
          <a href="https://github.com/jameslbarnes/auditor" target="_blank" rel="noopener">Source</a>
        </div>
      </footer>
    </div>
  )
}
