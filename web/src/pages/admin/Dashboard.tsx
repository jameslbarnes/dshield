import { useState, useEffect } from 'react'
import { Code2, Lock, KeyRound, Activity } from 'lucide-react'
import { api, type StoredFunction, type ApiKey, type Secret } from '../../lib/api'

export function Dashboard() {
  const [functions, setFunctions] = useState<StoredFunction[]>([])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [health, setHealth] = useState<{ status: string; uptime: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [funcs, keysData, secretsData, healthData] = await Promise.all([
          api.getFunctions().catch(() => ({ functions: [] })),
          api.getKeys().catch(() => ({ keys: [] })),
          api.getSecrets().catch(() => ({ secrets: [] })),
          api.getHealth().catch(() => null)
        ])
        setFunctions(funcs.functions)
        setKeys(keysData.keys)
        setSecrets(secretsData.secrets)
        setHealth(healthData)
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
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
        <h1>Dashboard</h1>
        <p>Overview of your D-Shield deployment</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Functions</div>
          <div className="stat-value">{functions.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Secrets</div>
          <div className="stat-value">{secrets.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">API Keys</div>
          <div className="stat-value">{keys.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Uptime</div>
          <div className="stat-value accent">
            {health ? formatUptime(health.uptime) : '—'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Functions</span>
          </div>
          {functions.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem' }}>
              <Code2 size={24} style={{ opacity: 0.5, marginBottom: '0.5rem' }} />
              <p style={{ fontSize: '0.8125rem' }}>No functions deployed yet</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Runtime</th>
                  </tr>
                </thead>
                <tbody>
                  {functions.slice(0, 5).map(fn => (
                    <tr key={fn.id}>
                      <td style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{fn.name}</td>
                      <td>
                        <span className="badge badge-success">{fn.runtime}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Quick Actions</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <a href="/admin/functions" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
              <Code2 size={16} />
              Deploy a Function
            </a>
            <a href="/admin/secrets" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
              <Lock size={16} />
              Add a Secret
            </a>
            <a href="/admin/keys" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
              <KeyRound size={16} />
              Create API Key
            </a>
            <a href="/admin/logs" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
              <Activity size={16} />
              View Logs
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
