import { createContext, useContext, useState, type ReactNode } from 'react'

interface AuthContextType {
  apiKey: string | null
  setApiKey: (key: string | null) => void
  isAuthenticated: boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState<string | null>(() => {
    return localStorage.getItem('dshield_api_key')
  })

  const setApiKey = (key: string | null) => {
    if (key) {
      localStorage.setItem('dshield_api_key', key)
    } else {
      localStorage.removeItem('dshield_api_key')
    }
    setApiKeyState(key)
  }

  const logout = () => {
    setApiKey(null)
  }

  return (
    <AuthContext.Provider value={{
      apiKey,
      setApiKey,
      isAuthenticated: !!apiKey,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
