import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import type { Project } from '../lib/types'
import { BrandLockup } from './Logo'
import { RoleGate } from './RoleGate'

const PROJECT_NAV = [
  { to: 'dashboard', label: 'Dashboard', icon: 'ph-gauge' },
  { to: 'traces', label: 'Traces', icon: 'ph-list-magnifying-glass' },
  { to: 'settings', label: 'Settings', icon: 'ph-gear-six' },
]

// Per the Access page's own role cards: Developer can create ingest keys, but only
// Admin manages members/access — so the two nav items don't share one visibility rule.
const ADMIN_NAV: { to: string; label: string; icon: string; roles: ('admin' | 'developer')[] }[] = [
  { to: 'keys', label: 'API keys', icon: 'ph-key', roles: ['admin', 'developer'] },
  { to: 'members', label: 'Access', icon: 'ph-users-three', roles: ['admin'] },
]

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

  useEffect(() => {
    api.listProjects().then(setProjects)
  }, [])

  const current = projects.find((p) => p.id === projectId)
  // Admin/developer tooling (keys, access) isn't gated on having a project open — it just
  // needs *a* project to point at, defaulting to the first one when none is selected yet.
  const adminTarget = current ?? projects[0]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/projects" className="brand">
          <BrandLockup />
        </NavLink>

        <NavLink to="/projects" className={({ isActive }) => `sideitem${isActive ? ' active' : ''}`}>
          <i className="ph ph-folders" />
          All projects
        </NavLink>

        {current && (
          <>
            <div className="project-indicator">
              <span className="dot" />
              <span>{current.name}</span>
            </div>
            <nav className="nav-group">
              {PROJECT_NAV.map((item) => (
                <NavLink key={item.to} to={`/${current.id}/${item.to}`} className={({ isActive }) => `sideitem${isActive ? ' active' : ''}`}>
                  <i className={`ph ${item.icon}`} />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </>
        )}

        {adminTarget && ADMIN_NAV.some((item) => hasRole(...item.roles)) && (
          <nav className="nav-group">
            {hasRole('admin') && <div className="nav-label">Admin</div>}
            {ADMIN_NAV.filter((item) => hasRole(...item.roles)).map((item) => (
              <NavLink key={item.to} to={`/${adminTarget.id}/${item.to}`} className={({ isActive }) => `sideitem${isActive ? ' active' : ''}`}>
                <i className={`ph ${item.icon}`} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="sidebar-footer">
          <button className="themebtn" onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}>
            <i className={`ph ${resolved === 'dark' ? 'ph-sun' : 'ph-moon'}`} />
            {resolved === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <div className="sdk-status">SDK 0.1.3 · ingest healthy</div>
          <button className="sideitem" style={{ color: 'var(--c-muted)', fontSize: 11.5 }} onClick={async () => { await logout(); navigate('/login') }}>
            <i className="ph ph-sign-out" style={{ fontSize: 13 }} />
            Sign out
          </button>
          <NavLink to="/account" className={({ isActive }) => `sideitem account-row${isActive ? ' active' : ''}`}>
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
