import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import type { Project, WatcherVersion } from '../lib/types'
import { BrandLockup } from './Logo'
import { PilotIcon, TracesIcon } from './NavIcons'
import { RoleGate } from './RoleGate'

const PROJECT_NAV: { to: string; label: string; icon: React.ReactNode; soon?: boolean }[] = [
  { to: 'dashboard', label: 'Dashboard', icon: <i className="ph ph-gauge" /> },
  { to: 'traces', label: 'Traces', icon: <TracesIcon /> },
  { to: 'pilot', label: 'Pilot', icon: <PilotIcon />, soon: true },
  { to: 'settings', label: 'Settings', icon: <i className="ph ph-gear-six" /> },
]

// Per the Access page's own role cards: Developer can create ingest keys, but only
// Admin manages members/access — so the two nav items don't share one visibility rule.
const ADMIN_NAV: { to: string; label: string; icon: string; roles: ('admin' | 'developer')[] }[] = [
  { to: 'keys', label: 'API keys', icon: 'ph-key', roles: ['admin', 'developer'] },
  { to: 'members', label: 'Access', icon: 'ph-users-three', roles: ['admin'] },
]

// Sidebar collapsed to an icon strip, remembered per browser. Storage can throw or be empty
// (private windows, blocked site data); the sidebar then just starts expanded.
const COLLAPSED_KEY = 'orkes-sidebar-collapsed'
function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}
function saveCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // not saved; applies until the page reloads
  }
}

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function AppShell() {
  const { projectId } = useParams<{ projectId?: string }>()
  const navigate = useNavigate()
  const { user, logout, hasRole } = useAuth()
  const { resolved, setPreference } = useTheme()
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState<WatcherVersion | null>(null)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      saveCollapsed(!c)
      return !c
    })
  // Collapsed, each item shows only its icon, so its label becomes the tooltip.
  const tip = (label: string) => (collapsed ? label : undefined)

  function loadProjects() {
    setError(null)
    api.listProjects().then(setProjects).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load projects'))
  }

  useEffect(() => {
    loadProjects()
    api.getVersion().then(setVersion).catch(() => setVersion(null))
  }, [])

  const current = projects.find((p) => p.id === projectId)
  // Admin/developer tooling (keys, access) isn't gated on having a project open — it just
  // needs *a* project to point at, defaulting to the first one when none is selected yet.
  const adminTarget = current ?? projects[0]

  return (
    <div className="app-shell">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-top">
          <NavLink to="/projects" className="brand sidebar-brand" title={tip('Orkes Watcher')}>
            <BrandLockup size={collapsed ? 34 : 38} />
          </NavLink>
          <button
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            <i className={`ph ${collapsed ? 'ph-caret-double-right' : 'ph-caret-double-left'}`} />
          </button>
        </div>

        <NavLink to="/projects" title={tip('All projects')} className={({ isActive }) => `sideitem${isActive ? ' active' : ''}`}>
          <i className="ph ph-folders" />
          <span className="label">All projects</span>
        </NavLink>

        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 7, background: 'var(--c-panel)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
            <span style={{ fontSize: 11.5, color: 'var(--color-danger)' }}>{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={loadProjects}>Retry</button>
          </div>
        )}

        {current && (
          <>
            <div className="project-indicator" title={tip(current.name)}>
              <span className="dot" />
              <span>{current.name}</span>
            </div>
            <nav className="nav-group">
              {PROJECT_NAV.map((item) => (
                <NavLink key={item.to} to={`/${current.id}/${item.to}`} title={tip(item.soon ? `${item.label} (coming soon)` : item.label)} className={({ isActive }) => `sideitem${isActive ? ' active' : ''}`}>
                  {item.icon}
                  <span className="label">{item.label}</span>
                  {item.soon && <span className="label nav-soon">Soon</span>}
                </NavLink>
              ))}
            </nav>
          </>
        )}

        {adminTarget && ADMIN_NAV.some((item) => hasRole(...item.roles)) && (
          <nav className="nav-group">
            {hasRole('admin') && <div className="nav-label">Admin</div>}
            {ADMIN_NAV.filter((item) => hasRole(...item.roles)).map((item) => (
              <NavLink key={item.to} to={`/${adminTarget.id}/${item.to}`} title={tip(item.label)} className={({ isActive }) => `sideitem${isActive ? ' active' : ''}`}>
                <i className={`ph ${item.icon}`} />
                <span className="label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        )}

        <div className="sidebar-footer">
          <button className="themebtn" title={tip(resolved === 'dark' ? 'Light mode' : 'Dark mode')} onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}>
            <i className={`ph ${resolved === 'dark' ? 'ph-sun' : 'ph-moon'}`} />
            <span className="label">{resolved === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <div className="sdk-status">
            {version ? (
              <>
                <Link to={`/changelog/${version.watcher_version}`} title="What's new in this watcher version">
                  Watcher {version.watcher_version}
                </Link>
                {' · '}
                <Link to={`/contract/${version.contract.latest}`} title="The orkes trace contract this watcher accepts">
                  contract {version.contract.latest}
                </Link>
              </>
            ) : (
              'Watcher version unavailable'
            )}
          </div>
          <button className="sideitem sign-out" title={tip('Sign out')} style={{ color: 'var(--c-muted)' }} onClick={async () => { await logout(); navigate('/login') }}>
            <i className="ph ph-sign-out" />
            <span className="label">Sign out</span>
          </button>
          <NavLink to="/account" title={tip(user ? `${user.name} · account` : 'Account')} className={({ isActive }) => `sideitem account-row${isActive ? ' active' : ''}`}>
            <span className="account-avatar">{user ? initials(user.name) : ''}</span>
            <div className="account-meta">
              <span>{user?.name}</span>
              <span className="role">{user?.role}</span>
            </div>
            <i className="ph ph-caret-right caret" />
          </NavLink>
        </div>
      </aside>

      <div className="main">
        <Outlet context={{ project: current } satisfies { project: Project | undefined }} />
      </div>
    </div>
  )
}

export function useCurrentProject() {
  return useOutletContext<{ project: Project | undefined }>().project
}

export { RoleGate }
