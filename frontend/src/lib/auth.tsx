import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from './mockApi'
import type { Role, User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  hasRole: (...roles: Role[]) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

const STORAGE_KEY = 'orkes.session.user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        setUser(JSON.parse(raw))
      } catch {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
    setLoading(false)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const u = await api.login(email, password)
        setUser(u)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
      },
      logout: () => {
        setUser(null)
        localStorage.removeItem(STORAGE_KEY)
      },
      hasRole: (...roles) => !!user && roles.includes(user.role),
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
