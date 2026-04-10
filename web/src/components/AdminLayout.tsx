import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Shield, LayoutDashboard, Code2, KeyRound, Lock, ScrollText, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import './AdminLayout.css'

export function AdminLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="sidebar-header">
          <NavLink to="/" className="sidebar-logo">
            <Shield size={20} strokeWidth={2.5} />
            <span>Auditor</span>
          </NavLink>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/admin" end className="nav-item">
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/admin/functions" className="nav-item">
            <Code2 size={18} />
            <span>Functions</span>
          </NavLink>
          <NavLink to="/admin/secrets" className="nav-item">
            <Lock size={18} />
            <span>Secrets</span>
          </NavLink>
          <NavLink to="/admin/keys" className="nav-item">
            <KeyRound size={18} />
            <span>API Keys</span>
          </NavLink>
          <NavLink to="/admin/logs" className="nav-item">
            <ScrollText size={18} />
            <span>Logs</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="nav-item logout-btn">
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
