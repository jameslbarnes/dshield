import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { api } from './lib/api'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { Report } from './pages/Report'
import { AdminLayout } from './components/AdminLayout'
import { Dashboard } from './pages/admin/Dashboard'
import { Functions } from './pages/admin/Functions'
import { Secrets } from './pages/admin/Secrets'
import { Keys } from './pages/admin/Keys'
import { Logs } from './pages/admin/Logs'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, apiKey } = useAuth()

  useEffect(() => {
    if (apiKey) {
      api.setApiKey(apiKey)
    }
  }, [apiKey])

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/report/:appId" element={<Report />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="functions" element={<Functions />} />
        <Route path="secrets" element={<Secrets />} />
        <Route path="keys" element={<Keys />} />
        <Route path="logs" element={<Logs />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
