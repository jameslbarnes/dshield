import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Shield, Lock, Globe, ExternalLink, Copy, CheckCircle2, Clock, AlertCircle, Server, Monitor } from 'lucide-react'
import './Report.css'

const API_BASE = ''

interface Destination {
  host: string
  requestCount: number
  lastSeen: string
  methods: string[]
  initiators?: string[]
}

interface AppReport {
  appId: string
  appName: string
  generatedAt: string
  server: {
    status: 'active' | 'inactive' | 'never'
    lastSeen: string | null
    attestation: {
      publicKey: string
      raReportUrl: string | null
    }
    destinations: Destination[]
    totalRequests: number
  }
  client: {
    status: 'active' | 'inactive' | 'never'
    lastSeen: string | null
    sdkDetected: boolean | null
    sdkDetectedAt: string | null
    verificationNote: string
    destinations: Destination[]
    totalRequests: number
  }
}

function formatTimeAgo(timestamp: string | null): string {
  if (!timestamp) return 'Never'
  const diff = Date.now() - new Date(timestamp).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function StatusIndicator({ status }: { status: 'active' | 'inactive' | 'never' }) {
  const colors = {
    active: 'status-active',
    inactive: 'status-inactive',
    never: 'status-never'
  }
  const labels = {
    active: 'Active',
    inactive: 'Inactive',
    never: 'No data'
  }
  return (
    <span className={`status-indicator ${colors[status]}`}>
      <span className="status-dot" />
      {labels[status]}
    </span>
  )
}

export function Report() {
  const { appId } = useParams<{ appId: string }>()
  const [report, setReport] = useState<AppReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function fetchReport() {
      try {
        const res = await fetch(`${API_BASE}/report/${appId}.json`)
        if (!res.ok) throw new Error('Failed to fetch report')
        const data = await res.json()
        setReport(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    fetchReport()
  }, [appId])

  const copyPublicKey = async () => {
    if (report?.server.attestation.publicKey) {
      await navigator.clipboard.writeText(report.server.attestation.publicKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <div className="report-page">
        <div className="report-loading">Loading report...</div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="report-page">
        <div className="report-error">
          <AlertCircle size={24} />
          <p>Failed to load report</p>
          <code>{error}</code>
        </div>
      </div>
    )
  }

  return (
    <div className="report-page">
      <header className="report-header">
        <div className="header-left">
          <Link to="/" className="logo-link">
            <Shield size={20} strokeWidth={2.5} />
            <span className="logo-text">Auditor</span>
          </Link>
        </div>
        <nav className="header-nav">
          <a href={`${API_BASE}/report/${appId}.json`} target="_blank" rel="noopener" className="json-link">
            <code>JSON</code>
          </a>
        </nav>
      </header>

      <main className="report-main">
        <section className="report-title-section">
          <h1>{report.appName}</h1>
          <p className="report-subtitle">
            <Clock size={14} />
            Egress Report · Updated {formatTimeAgo(report.generatedAt)}
          </p>
        </section>

        {/* Server-side Section */}
        <section className="report-section server-section">
          <div className="section-header">
            <div className="section-icon server">
              <Server size={18} />
            </div>
            <div className="section-title">
              <h2>Server-Side</h2>
              <span className="section-badge tee">TEE-Attested</span>
            </div>
          </div>

          <div className="section-meta">
            <div className="meta-item">
              <span className="meta-label">Status</span>
              <StatusIndicator status={report.server.status} />
              {report.server.lastSeen && (
                <span className="meta-time">Last seen {formatTimeAgo(report.server.lastSeen)}</span>
              )}
            </div>
            <div className="meta-item">
              <span className="meta-label">Total Requests</span>
              <span className="meta-value">{report.server.totalRequests.toLocaleString()}</span>
            </div>
          </div>

          <div className="attestation-box">
            <div className="attestation-header">
              <Lock size={14} />
              <span>Attestation</span>
            </div>
            <div className="attestation-content">
              <div className="public-key">
                <span className="key-label">Public Key</span>
                <div className="key-value">
                  <code>{report.server.attestation.publicKey.slice(0, 64)}...</code>
                  <button onClick={copyPublicKey} className="copy-btn" title="Copy full key">
                    {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
              {report.server.attestation.raReportUrl && (
                <a href={report.server.attestation.raReportUrl} target="_blank" rel="noopener" className="ra-link">
                  View Remote Attestation Report
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>

          {report.server.destinations.length > 0 ? (
            <div className="destinations-table">
              <div className="table-header">
                <span className="col-host">Destination</span>
                <span className="col-count">Requests</span>
                <span className="col-methods">Methods</span>
                <span className="col-last">Last Seen</span>
              </div>
              {report.server.destinations.map((dest) => (
                <div key={dest.host} className="table-row">
                  <span className="col-host mono">{dest.host}</span>
                  <span className="col-count">{dest.requestCount.toLocaleString()}</span>
                  <span className="col-methods">
                    {dest.methods.map((m) => (
                      <span key={m} className={`method-badge method-${m.toLowerCase()}`}>{m}</span>
                    ))}
                  </span>
                  <span className="col-last">{formatTimeAgo(dest.lastSeen)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-data">
              <p>No server-side egress recorded</p>
            </div>
          )}
        </section>

        {/* Client-side Section */}
        <section className="report-section client-section">
          <div className="section-header">
            <div className="section-icon client">
              <Monitor size={18} />
            </div>
            <div className="section-title">
              <h2>Client-Side</h2>
              <span className="section-badge client">Self-Reported</span>
            </div>
          </div>

          <div className="section-meta">
            <div className="meta-item">
              <span className="meta-label">Status</span>
              <StatusIndicator status={report.client.status} />
              {report.client.lastSeen && (
                <span className="meta-time">Last seen {formatTimeAgo(report.client.lastSeen)}</span>
              )}
            </div>
            <div className="meta-item">
              <span className="meta-label">Total Requests</span>
              <span className="meta-value">{report.client.totalRequests.toLocaleString()}</span>
            </div>
          </div>

          <div className="verification-box">
            <div className="verification-header">
              <Globe size={14} />
              <span>Verification</span>
            </div>
            <p className="verification-note">{report.client.verificationNote}</p>
            {report.client.sdkDetected !== null && (
              <div className="sdk-status">
                {report.client.sdkDetected ? (
                  <span className="sdk-detected">
                    <CheckCircle2 size={14} />
                    SDK detected
                    {report.client.sdkDetectedAt && (
                      <span className="sdk-time">{formatTimeAgo(report.client.sdkDetectedAt)}</span>
                    )}
                  </span>
                ) : (
                  <span className="sdk-not-detected">
                    <AlertCircle size={14} />
                    SDK not detected
                  </span>
                )}
              </div>
            )}
          </div>

          {report.client.destinations.length > 0 ? (
            <div className="destinations-table">
              <div className="table-header">
                <span className="col-host">Destination</span>
                <span className="col-count">Requests</span>
                <span className="col-methods">Initiators</span>
                <span className="col-last">Last Seen</span>
              </div>
              {report.client.destinations.map((dest) => (
                <div key={dest.host} className="table-row">
                  <span className="col-host mono">{dest.host}</span>
                  <span className="col-count">{dest.requestCount.toLocaleString()}</span>
                  <span className="col-methods">
                    {(dest.initiators || dest.methods).map((m) => (
                      <span key={m} className="initiator-badge">{m}</span>
                    ))}
                  </span>
                  <span className="col-last">{formatTimeAgo(dest.lastSeen)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-data">
              <p>No client-side egress recorded</p>
            </div>
          )}
        </section>
      </main>

      <footer className="report-footer">
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
          <Link to="/">Home</Link>
          <span className="footer-divider">·</span>
          <a href={`${API_BASE}/publicKey`} target="_blank" rel="noopener">Public Key</a>
        </div>
      </footer>
    </div>
  )
}
