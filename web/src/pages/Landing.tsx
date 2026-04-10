import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Shield, CheckCircle2, ExternalLink, ArrowRight, Lock, FileCode, Settings, Globe, Database, Sparkles, Clock } from 'lucide-react'
import './Landing.css'

const API_BASE = ''

type SourceFilter = 'all' | 'tee' | 'client'

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

export function Landing() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  // Client app IDs that have submitted logs - in a real app this would be fetched from the server
  const [clientAppIds] = useState<string[]>([])

  const fetchLogs = async () => {
    try {
      // Get all functions first
      const fnRes = await fetch(`${API_BASE}/functions`)
      if (!fnRes.ok) throw new Error('Failed to fetch functions')
      const fnData = await fnRes.json()

      // Fetch logs for each function and combine
      const allLogs: LogEntry[] = []
      for (const fn of fnData.functions || []) {
        try {
          const logRes = await fetch(`${API_BASE}/logs/${fn.id}`)
          if (logRes.ok) {
            const logData: LogsResponse = await logRes.json()
            // Mark function logs as TEE-attested if not already marked
            allLogs.push(...logData.entries.map(e => ({
              ...e,
              source: e.source || 'tee' as const
            })))
          }
        } catch {
          // Skip failed log fetches
        }
      }

      // Also fetch client logs if we have known app IDs
      for (const appId of clientAppIds) {
        try {
          const logRes = await fetch(`${API_BASE}/logs/client:${appId}`)
          if (logRes.ok) {
            const logData: LogsResponse = await logRes.json()
            allLogs.push(...logData.entries)
          }
        } catch {
          // Skip failed log fetches
        }
      }

      // Sort by timestamp descending
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

  // Filter logs based on source
  const filteredLogs = logs.filter(log => {
    if (sourceFilter === 'all') return true
    return log.source === sourceFilter
  })

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
          <p className="hero-eyebrow">For developers who respect user privacy</p>
          <h1>Prove you're doing<br/>the right thing.</h1>
          <p className="subtitle">
            "We don't sell your data" means nothing without proof. Add verifiable egress logs to your app in minutes.
          </p>
        </section>

        <section className="problem">
          <div className="problem-text">
            <h2>The trust problem</h2>
            <p>
              You know your app only talks to the APIs it needs. Your users don't.
              Privacy policies are just words. Auditor turns them into <strong>cryptographic proof</strong>.
            </p>
          </div>
          <div className="problem-points">
            <div className="problem-point">
              <span className="problem-icon">?</span>
              <span>Users can't verify privacy claims</span>
            </div>
            <div className="problem-point">
              <span className="problem-icon">?</span>
              <span>AI agents need trust signals</span>
            </div>
            <div className="problem-point">
              <span className="problem-icon">?</span>
              <span>"Trust us" doesn't scale</span>
            </div>
          </div>
        </section>

        <section className="solution">
          <h2>Two ways to prove it</h2>
          <p className="solution-subtitle">Choose based on your architecture. Use both for full coverage.</p>
        </section>

        <section className="pillars">
          <div className="pillar server-pillar">
            <div className="pillar-icon">
              <Lock size={24} />
            </div>
            <h2>Serverless Functions</h2>
            <span className="pillar-badge tee">TEE-Attested</span>
            <p className="pillar-desc">
              Deploy your backend to a Trusted Execution Environment. Every outbound request gets cryptographically signed. <strong>Not even you can fake the logs.</strong>
            </p>
            <ul className="pillar-features">
              <li><CheckCircle2 size={14} /> Hardware-enforced isolation</li>
              <li><CheckCircle2 size={14} /> Tamper-proof signatures</li>
              <li><CheckCircle2 size={14} /> Verifiable attestation</li>
            </ul>
            <a href="https://docs.phala.com/dstack" target="_blank" rel="noopener" className="pillar-link">
              Deploy Now
              <ArrowRight size={14} />
            </a>
          </div>

          <div className="pillar client-pillar">
            <div className="pillar-icon">
              <Globe size={24} />
            </div>
            <h2>Client SDK</h2>
            <span className="pillar-badge client">Self-Reported</span>
            <p className="pillar-desc">
              One script tag. Every fetch, XHR, and WebSocket logged. Users can open dev tools and verify—<strong>your transparency becomes their trust.</strong>
            </p>
            <ul className="pillar-features">
              <li><CheckCircle2 size={14} /> 3 lines to integrate</li>
              <li><CheckCircle2 size={14} /> User-verifiable in browser</li>
              <li><CheckCircle2 size={14} /> Works with any framework</li>
            </ul>
            <a href="https://github.com/jameslbarnes/auditor" target="_blank" rel="noopener" className="pillar-link">
              Get the SDK
              <ArrowRight size={14} />
            </a>
          </div>
        </section>

        <div className="report-cta">
          <Link to="/report/demo" className="report-link">
            <FileCode size={16} />
            View Example Report
          </Link>
        </div>

        <section className="roadmap">
          <h2>Roadmap</h2>
          <p className="roadmap-subtitle">What's coming next</p>

          <div className="roadmap-items">
            <div className="roadmap-item now">
              <div className="roadmap-status">
                <CheckCircle2 size={16} />
                <span>Now</span>
              </div>
              <h3>Field-Level Logging</h3>
              <p>See exactly which database fields your app writes. Automatic detection for Firestore, Supabase, and more.</p>
            </div>

            <div className="roadmap-item next">
              <div className="roadmap-status">
                <Sparkles size={16} />
                <span>Next</span>
              </div>
              <h3>Storage Attestation</h3>
              <p>Prove data is encrypted before database writes. TEE-managed encryption keys, entropy verification, field-level proofs.</p>
            </div>

            <div className="roadmap-item future">
              <div className="roadmap-status">
                <Clock size={16} />
                <span>Future</span>
              </div>
              <h3>Self-Sovereign Storage</h3>
              <p>User data on user-controlled infrastructure. Code that won't run without verifiable data ownership.</p>
            </div>
          </div>
        </section>

        <section className="live-feed">
          <div className="feed-header">
            <div className="feed-title">
              <div className={`live-indicator ${loading ? 'loading' : ''}`} />
              <span>Live Egress Log</span>
            </div>
            <div className="feed-filters">
              <button
                className={`filter-btn ${sourceFilter === 'all' ? 'active' : ''}`}
                onClick={() => setSourceFilter('all')}
              >
                All
              </button>
              <button
                className={`filter-btn ${sourceFilter === 'tee' ? 'active' : ''}`}
                onClick={() => setSourceFilter('tee')}
              >
                <Lock size={12} />
                TEE
              </button>
              <button
                className={`filter-btn ${sourceFilter === 'client' ? 'active' : ''}`}
                onClick={() => setSourceFilter('client')}
              >
                <Globe size={12} />
                Client
              </button>
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
                <p>Unable to connect to D-Shield runtime</p>
                <code>{error}</code>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="feed-empty">
                <p>No API calls logged yet.</p>
                <p className="feed-empty-hint">Deploy a function and make some requests to see them appear here.</p>
              </div>
            ) : (
              <div className="feed-logs">
                <div className="feed-logs-header">
                  <span className="col-source">Source</span>
                  <span className="col-app">App</span>
                  <span className="col-fn">Function</span>
                  <span className="col-method">Method</span>
                  <span className="col-url">Destination</span>
                  <span className="col-fields">Fields</span>
                  <span className="col-sig">Verified</span>
                </div>
                {filteredLogs.slice(-50).reverse().map((log, i) => (
                  <div key={`${log.sequence}-${i}`} className={`log-entry ${log.source === 'client' ? 'client-log' : 'tee-log'}`}>
                    <span className="col-source">
                      {log.source === 'client' ? (
                        <span className="source-badge client" title="Self-reported by client SDK">
                          <Globe size={12} />
                          Client
                        </span>
                      ) : (
                        <span className="source-badge tee" title="TEE-attested and signed">
                          <Lock size={12} />
                          TEE
                        </span>
                      )}
                    </span>
                    <span className="col-app mono">{log.appName || 'unknown'}</span>
                    <span className="col-fn mono">
                      {log.functionId.startsWith('client:') ? log.initiator || 'client' : log.functionId}
                    </span>
                    <span className={`col-method method-${log.method.toLowerCase()}`}>{log.method}</span>
                    <span className="col-url mono">{formatDestination(log)}</span>
                    <span className="col-fields">
                      {log.dbWrite ? (
                        <span className="fields-badge" title={`Writing to ${log.dbWrite.collection || 'database'}: ${log.dbWrite.fields.join(', ')}`}>
                          <Database size={12} />
                          {log.dbWrite.fields.length > 0 ? (
                            <span className="fields-list">{log.dbWrite.fields.slice(0, 3).join(', ')}{log.dbWrite.fields.length > 3 ? '...' : ''}</span>
                          ) : (
                            <span className="fields-list">{log.dbWrite.provider}</span>
                          )}
                        </span>
                      ) : (
                        <span className="fields-none">—</span>
                      )}
                    </span>
                    <span className="col-sig">
                      {log.source === 'client' ? (
                        <span className="sig-self" title="Self-reported (verifiable via dev tools)">—</span>
                      ) : (
                        <span title="Cryptographically signed">
                          <CheckCircle2 size={14} className="sig-icon" />
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="cta">
          <a href={`${API_BASE}/health`} target="_blank" rel="noopener" className="cta-button">
            View Runtime Status
            <ExternalLink size={16} />
          </a>
          <a href="https://github.com/jameslbarnes/auditor" className="cta-link">
            Deploy your own
            <ArrowRight size={16} />
          </a>
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
