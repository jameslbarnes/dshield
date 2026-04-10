import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, ArrowRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import './Login.css'

export function Login() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { setApiKey: saveApiKey } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Test the API key
      api.setApiKey(apiKey)
      await api.getHealth()
      saveApiKey(apiKey)
      navigate('/admin')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid API key')
      api.setApiKey(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <Shield size={32} strokeWidth={2} />
          <h1>Auditor Admin</h1>
          <p>Enter your API key to access the management console</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              type="password"
              className="form-input"
              placeholder="auditor_..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="login-button"
            disabled={!apiKey || loading}
          >
            {loading ? 'Authenticating...' : 'Continue'}
            <ArrowRight size={18} />
          </button>
        </form>

        <div className="login-footer">
          <p>
            Don't have an API key?{' '}
            <a href="https://github.com/jameslbarnes/auditor" target="_blank" rel="noopener">
              Deploy your own Auditor instance
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
