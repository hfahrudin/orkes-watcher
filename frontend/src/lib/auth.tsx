import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from './api'
import type { Role, User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  hasRole: (...roles: Role[]) => boolean
  activate: (token: string, password: string, name?: string) => Promise<void>
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // The session lives in an httpOnly cookie the browser already sends automatically —
    // there's nothing for JS to read on its own, so the only way to know "am I logged in"
    // on a fresh page load is to ask the backend.
    api.me().then((u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const u = await api.login(email, password)
        setUser(u)
      },
      logout: async () => {
        await api.logout()
        setUser(null)
      },
      hasRole: (...roles) => !!user && roles.includes(user.role),
      activate: async (token, password, name) => {
        const u = await api.activateAccount(token, password, name)
        setUser(u)
      },
      setUser,
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
