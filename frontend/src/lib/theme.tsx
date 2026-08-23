import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type Resolved = 'dark' | 'light'
export type ThemePreference = Resolved | 'system'
const STORAGE_KEY = 'orkes-theme'

const ThemeContext = createContext<{
  preference: ThemePreference
  resolved: Resolved
  setPreference: (p: ThemePreference) => void
} | null>(null)

function readInitialPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    /* private browsing, etc. */
  }
  return 'system'
}

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readInitialPreference)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: Resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p)
    try {
      localStorage.setItem(STORAGE_KEY, p)
    } catch {
      /* private browsing, etc. — preference just won't persist */
    }
  }

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
