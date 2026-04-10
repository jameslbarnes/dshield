import { useState, useEffect } from 'react'
import { Plus, Trash2, Play, X, Code2 } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { api, type StoredFunction } from '../../lib/api'
import './Functions.css'

const DEFAULT_NODE_CODE = `// Handler receives the request body as 'event'
// Return value is sent as JSON response
module.exports = async function handler(event) {
  return {
    message: "Hello from D-Shield!",
    received: event
  };
};
`

const DEFAULT_PYTHON_CODE = `# Handler receives the request body as 'event'
# Return value is sent as JSON response
def handler(event):
    return {
        "message": "Hello from D-Shield!",
        "received": event
    }
`

export function Functions() {
  const [functions, setFunctions] = useState<StoredFunction[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showInvoke, setShowInvoke] = useState<StoredFunction | null>(null)
  const [invokePayload, setInvokePayload] = useState('{}')
  const [invokeResult, setInvokeResult] = useState<string | null>(null)
  const [invoking, setInvoking] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [runtime, setRuntime] = useState<'node' | 'python'>('node')
  const [handler, setHandler] = useState('handler')
  const [code, setCode] = useState(DEFAULT_NODE_CODE)
  const [timeout, setTimeout] = useState(30)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchFunctions = async () => {
    try {
      const data = await api.getFunctions()
      setFunctions(data.functions)
    } catch (e) {
      console.error('Failed to fetch functions:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFunctions()
  }, [])

  useEffect(() => {
    if (runtime === 'node') {
      setCode(DEFAULT_NODE_CODE)
    } else {
      setCode(DEFAULT_PYTHON_CODE)
    }
  }, [runtime])

  const handleCreate = async () => {
    setError(null)
    setCreating(true)
    try {
      await api.createFunction({
        name,
        runtime,
        handler,
        code: btoa(code),
        timeout
      })
      setShowCreate(false)
      setName('')
      setRuntime('node')
      setHandler('handler')
      setCode(DEFAULT_NODE_CODE)
      setTimeout(30)
      fetchFunctions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create function')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this function?')) return
    try {
      await api.deleteFunction(id)
      fetchFunctions()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete function')
    }
  }

  const handleInvoke = async () => {
    if (!showInvoke) return
    setInvoking(true)
    setInvokeResult(null)
    try {
      const payload = JSON.parse(invokePayload)
      const result = await api.invokeFunction(showInvoke.id, payload)
      setInvokeResult(JSON.stringify(result, null, 2))
    } catch (e) {
      setInvokeResult(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setInvoking(false)
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
        <h1>Functions</h1>
        <p>Deploy and manage serverless functions</p>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Deployed Functions</span>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            New Function
          </button>
        </div>

        {functions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Code2 size={24} />
            </div>
            <h3>No functions yet</h3>
            <p>Deploy your first function to get started</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              Create Function
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Runtime</th>
                  <th>Handler</th>
                  <th>Timeout</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {functions.map(fn => (
                  <tr key={fn.id}>
                    <td style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{fn.name}</td>
                    <td>
                      <span className="badge badge-success">{fn.runtime}</span>
                    </td>
                    <td style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-secondary)' }}>
                      {fn.handler}
                    </td>
                    <td>{fn.timeout}s</td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                      {new Date(fn.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setShowInvoke(fn)
                            setInvokePayload('{}')
                            setInvokeResult(null)
                          }}
                        >
                          <Play size={14} />
                          Test
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(fn.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
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
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Create Function</span>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Function Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="my-function"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Runtime</label>
                  <select
                    className="form-input form-select"
                    value={runtime}
                    onChange={e => setRuntime(e.target.value as 'node' | 'python')}
                  >
                    <option value="node">Node.js</option>
                    <option value="python">Python</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Handler</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="handler"
                    value={handler}
                    onChange={e => setHandler(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Timeout (seconds)</label>
                  <input
                    type="number"
                    className="form-input"
                    min={1}
                    max={300}
                    value={timeout}
                    onChange={e => setTimeout(parseInt(e.target.value) || 30)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Code</label>
                <div className="code-editor">
                  <CodeMirror
                    value={code}
                    height="300px"
                    theme="dark"
                    extensions={[runtime === 'node' ? javascript() : python()]}
                    onChange={value => setCode(value)}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!name || !code || creating}
              >
                {creating ? 'Creating...' : 'Create Function'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoke Modal */}
      {showInvoke && (
        <div className="modal-overlay" onClick={() => setShowInvoke(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                Test Function: <code style={{ color: 'var(--accent)' }}>{showInvoke.name}</code>
              </span>
              <button className="modal-close" onClick={() => setShowInvoke(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Request Payload (JSON)</label>
                <div className="code-editor">
                  <CodeMirror
                    value={invokePayload}
                    height="150px"
                    theme="dark"
                    extensions={[javascript()]}
                    onChange={value => setInvokePayload(value)}
                  />
                </div>
              </div>
              {invokeResult !== null && (
                <div className="form-group">
                  <label className="form-label">Response</label>
                  <pre className="invoke-result">{invokeResult}</pre>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowInvoke(null)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={handleInvoke}
                disabled={invoking}
              >
                <Play size={16} />
                {invoking ? 'Running...' : 'Invoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
