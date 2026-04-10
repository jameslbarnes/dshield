import { useState, useEffect } from 'react'
import { RefreshCw, CheckCircle2, ScrollText } from 'lucide-react'
import { api, type LogEntry, type StoredFunction } from '../../lib/api'

export function Logs() {
  const [functions, setFunctions] = useState<StoredFunction[]>([])
  const [selectedFunction, setSelectedFunction] = useState<string>('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [publicKey, setPublicKey] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const fetchFunctions = async () => {
      try {
        const data = await api.getFunctions()
        setFunctions(data.functions)
        if (data.functions.length > 0) {
          setSelectedFunction(data.functions[0].id)
        }
      } finally {
        setLoading(false)
      }
    }
    fetchFunctions()
  }, [])

  useEffect(() => {
    if (selectedFunction) {
      fetchLogs()
    }
  }, [selectedFunction])

  const fetchLogs = async () => {
    if (!selectedFunction) return
    setRefreshing(true)
    try {
      const data = await api.getLogs(selectedFunction)
      setLogs(data.entries)
      setPublicKey(data.publicKey)
    } catch (e) {
      console.error('Failed to fetch logs:', e)
    } finally {
      setRefreshing(false)
    }
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  }

  const formatUrl = (url: string) => {
    try {
      const parsed = new URL(url)
      return parsed.hostname + parsed.pathname
    } catch {
      return url
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading...
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1>Egress Logs</h1>
        <p>Cryptographically signed audit trail of all outbound requests</p>
      </div>

      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span className="card-title">Function Logs</span>
            {functions.length > 0 && (
              <select
                className="form-input form-select"
                style={{ width: 'auto', padding: '0.375rem 2rem 0.375rem 0.75rem' }}
                value={selectedFunction}
                onChange={e => setSelectedFunction(e.target.value)}
              >
                {functions.map(fn => (
                  <option key={fn.id} value={fn.id}>{fn.name}</option>
                ))}
              </select>
            )}
          </div>
          <button
            className="btn btn-secondary"
            onClick={fetchLogs}
            disabled={refreshing || !selectedFunction}
          >
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            Refresh
          </button>
        </div>

        {functions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <ScrollText size={24} />
            </div>
            <h3>No functions deployed</h3>
            <p>Deploy a function to start seeing egress logs</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <ScrollText size={24} />
            </div>
            <h3>No logs yet</h3>
            <p>Invoke this function to see outbound request logs</p>
          </div>
        ) : (
          <div className="table-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
            <table className="table">
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
                <tr>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Destination</th>
                  <th>Status</th>
                  <th>Signature</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice().reverse().map((log, i) => (
                  <tr key={`${log.sequence}-${i}`}>
                    <td style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.75rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {formatTime(log.timestamp)}
                    </td>
                    <td>
                      <span className={`badge ${
                        log.method === 'GET' ? 'badge-success' :
                        log.method === 'POST' ? 'badge-warning' :
                        log.method === 'DELETE' ? 'badge-error' :
                        'badge-success'
                      }`}>
                        {log.method}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.8125rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatUrl(log.url)}
                    </td>
                    <td>
                      {log.statusCode && (
                        <span style={{
                          color: log.statusCode >= 200 && log.statusCode < 300 ? 'var(--accent)' :
                                 log.statusCode >= 400 ? 'var(--error)' : 'var(--warning)'
                        }}>
                          {log.statusCode}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} />
                        <code style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>
                          {log.signature.slice(0, 12)}…
                        </code>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {publicKey && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card-header">
            <span className="card-title">Verification</span>
          </div>
          <div style={{ padding: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            <p style={{ marginBottom: '0.75rem' }}>
              Each log entry is signed with the TEE's private key. Verify signatures using this public key:
            </p>
            <pre style={{
              background: 'var(--bg-primary)',
              padding: '0.75rem',
              borderRadius: '6px',
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: '0.6875rem',
              overflow: 'auto',
              color: 'var(--text-tertiary)',
              wordBreak: 'break-all'
            }}>
              {publicKey}
            </pre>
          </div>
        </div>
      )}

      <style>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
