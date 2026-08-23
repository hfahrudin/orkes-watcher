import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LoginPage } from './pages/LoginPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { DashboardPage } from './pages/DashboardPage'
import { TracesPage } from './pages/TracesPage'
import { TraceInspectorPage } from './pages/TraceInspectorPage'
import { SettingsPage } from './pages/SettingsPage'
import { KeysPage } from './pages/KeysPage'
import { MembersPage } from './pages/MembersPage'
import { AccountPage } from './pages/AccountPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function Routed() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/:projectId/dashboard" element={<DashboardPage />} />
        <Route path="/:projectId/traces" element={<TracesPage />} />
        <Route path="/:projectId/traces/:runId" element={<TraceInspectorPage />} />
        <Route path="/:projectId/settings" element={<SettingsPage />} />
        <Route path="/:projectId/keys" element={<KeysPage />} />
        <Route path="/:projectId/members" element={<MembersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ErrorBoundary>
          <Routed />
        </ErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  )
}
