import { useState, useEffect } from 'react'
import { Plus, Trash2, X, KeyRound, Copy, Check } from 'lucide-react'
import { api, type ApiKey } from '../../lib/api'

const PERMISSIONS = [
  { value: 'functions:read', label: 'Read Functions', description: 'View function details' },
  { value: 'functions:write', label: 'Write Functions', description: 'Create, update, delete functions' },
  { value: 'functions:invoke', label: 'Invoke Functions', description: 'Execute functions' },
  { value: 'secrets:read', label: 'Read Secrets', description: 'List secret names (not values)' },
  { value: 'secrets:write', label: 'Write Secrets', description: 'Create, delete secrets' },
  { value: 'logs:read', label: 'Read Logs', description: 'View function logs' },
  { value: 'admin', label: 'Admin', description: 'Full access including key management' },
]

export function Keys() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [permissions, setPermissions] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchKeys = async () => {
    try {
      const data = await api.getKeys()
      setKeys(data.keys)
    } catch (e) {
      console.error('Failed to fetch keys:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchKeys()
  }, [])

  const handleCreate = async () => {
    setError(null)
    setCreating(true)
    try {
      const result = await api.createKey({ name, permissions })
      setNewKey(result.rawKey)
      fetchKeys()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create key')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key?')) return
    try {
      await api.deleteKey(id)
      fetchKeys()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete key')
    }
  }

  const togglePermission = (perm: string) => {
    setPermissions(prev =>
      prev.includes(perm)
        ? prev.filter(p => p !== perm)
        : [...prev, perm]
    )
  }

  const copyToClipboard = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const closeCreateModal = () => {
    setShowCreate(false)
    setName('')
    setPermissions([])
    setNewKey(null)
    setError(null)
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
        <h1>API Keys</h1>
        <p>Manage access to your D-Shield deployment</p>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Active Keys</span>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            Create Key
          </button>
        </div>

        {keys.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <KeyRound size={24} />
            </div>
            <h3>No API keys</h3>
            <p>Create an API key to access the management API</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              Create Key
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Permissions</th>
                  <th>Created</th>
                  <th>Last Used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map(key => (
                  <tr key={key.id}>
                    <td style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{key.name}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                        {key.permissions.map(perm => (
                          <span key={perm} className="badge badge-success">
                            {perm.split(':')[0]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                      {new Date(key.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(key.id)}
                      >
                        <Trash2 size={14} />
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={closeCreateModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{newKey ? 'API Key Created' : 'Create API Key'}</span>
              <button className="modal-close" onClick={closeCreateModal}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {newKey ? (
                <div>
                  <div style={{
                    padding: '1rem',
                    background: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid var(--accent)',
                    borderRadius: '8px',
                    marginBottom: '1rem'
                  }}>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      Copy this key now. You won't be able to see it again.
                    </p>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: 'var(--bg-primary)',
                      padding: '0.75rem',
                      borderRadius: '6px'
                    }}>
                      <code style={{
                        flex: 1,
                        fontFamily: 'IBM Plex Mono, monospace',
                        fontSize: '0.75rem',
                        color: 'var(--accent)',
                        wordBreak: 'break-all'
                      }}>
                        {newKey}
                      </code>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={copyToClipboard}
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
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
                    <label className="form-label">Key Name</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="production-backend"
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Permissions</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {PERMISSIONS.map(perm => (
                        <label
                          key={perm.value}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.5rem',
                            padding: '0.5rem',
                            background: permissions.includes(perm.value) ? 'var(--bg-tertiary)' : 'transparent',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'background 0.15s'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={permissions.includes(perm.value)}
                            onChange={() => togglePermission(perm.value)}
                            style={{ marginTop: '0.125rem' }}
                          />
                          <div>
                            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{perm.label}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                              {perm.description}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              {newKey ? (
                <button className="btn btn-primary" onClick={closeCreateModal}>
                  Done
                </button>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={closeCreateModal}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleCreate}
                    disabled={!name || permissions.length === 0 || creating}
                  >
                    {creating ? 'Creating...' : 'Create Key'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
