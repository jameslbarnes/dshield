import { useState, useEffect } from 'react'
import { Plus, Trash2, X, Lock } from 'lucide-react'
import { api, type Secret } from '../../lib/api'

export function Secrets() {
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSecrets = async () => {
    try {
      const data = await api.getSecrets()
      setSecrets(data.secrets)
    } catch (e) {
      console.error('Failed to fetch secrets:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSecrets()
  }, [])

  const handleCreate = async () => {
    setError(null)
    setCreating(true)
    try {
      await api.createSecret(name, value)
      setShowCreate(false)
      setName('')
      setValue('')
      fetchSecrets()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create secret')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete the secret "${name}"?`)) return
    try {
      await api.deleteSecret(name)
      fetchSecrets()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete secret')
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
        <h1>Secrets</h1>
        <p>Encrypted environment variables for your functions</p>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Stored Secrets</span>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            Add Secret
          </button>
        </div>

        {secrets.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Lock size={24} />
            </div>
            <h3>No secrets stored</h3>
            <p>Add secrets to use as environment variables in your functions</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              Add Secret
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {secrets.map(secret => (
                  <tr key={secret.name}>
                    <td style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{secret.name}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>••••••••••••</td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                      {new Date(secret.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                      {new Date(secret.updatedAt).toLocaleDateString()}
                    </td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(secret.name)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-header">
          <span className="card-title">Usage</span>
        </div>
        <div style={{ padding: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          <p style={{ marginBottom: '0.75rem' }}>
            Secrets are encrypted at rest using AES-256-GCM. To use a secret in your function,
            add its name to the function's <code style={{ color: 'var(--accent)' }}>envVars</code> array.
          </p>
          <pre style={{
            background: 'var(--bg-primary)',
            padding: '0.75rem',
            borderRadius: '6px',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '0.75rem',
            overflow: 'auto'
          }}>
{`// In your function code:
const apiKey = process.env.MY_API_KEY;

// When creating/updating the function, specify:
{
  "envVars": ["MY_API_KEY", "OTHER_SECRET"]
}`}
          </pre>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Add Secret</span>
              <button className="modal-close" onClick={() => setShowCreate(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {error && (
                <div style={{
                  padding: '0.75rem',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--error)',
                  borderRadius: '6px',
                  color: 'var(--error)',
                  fontSize: '0.8125rem',
                  marginBottom: '1rem'
                }}>
                  {error}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Secret Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="MY_API_KEY"
                  value={name}
                  onChange={e => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                  Use SCREAMING_SNAKE_CASE for consistency
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Secret Value</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter secret value"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!name || !value || creating}
              >
                {creating ? 'Adding...' : 'Add Secret'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
