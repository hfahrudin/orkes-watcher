import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { formatDateTime, formatRelativeTime } from '../lib/format'
import type { Session } from '../lib/types'

const SESSION_ICON: Record<Session['kind'], string> = { browser: 'ph-monitor', cli: 'ph-terminal-window' }

export function AccountPage() {
  const { user, setUser } = useAuth()
  const { preference, setPreference } = useTheme()
  const [sessions, setSessions] = useState<Session[]>([])
  const [name, setName] = useState(user?.name ?? '')
  const [saved, setSaved] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  const [sessionsError, setSessionsError] = useState<string | null>(null)

  useEffect(() => {
    api.listSessions().then(setSessions).catch((e) => setSessionsError(e instanceof Error ? e.message : 'Failed to load sessions'))
  }, [])

  async function signOutSession(id: string) {
    setSessionsError(null)
    try {
      await api.revokeSession(id)
      setSessions((s) => s.filter((sess) => sess.id !== id))
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : 'Failed to sign out that session')
    }
  }

  async function signOutOthers() {
    setSessionsError(null)
    try {
      await api.revokeOtherSessions()
      setSessions((s) => s.filter((sess) => sess.current))
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : 'Failed to sign out other sessions')
    }
  }

  async function saveName() {
    if (!name.trim()) return
    setNameError(null)
    setSavingName(true)
    try {
      const updated = await api.updateProfile(name.trim())
      setUser(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setNameError(e instanceof Error ? e.message : 'Failed to save name')
    } finally {
      setSavingName(false)
    }
  }

  async function submitPasswordChange() {
    setPasswordError(null)
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    setChangingPassword(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordSaved(true)
      setTimeout(() => setPasswordSaved(false), 1500)
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12, color: 'color-mix(in srgb, var(--color-text) 45%, transparent)' }}>
          {user?.name} · {user?.role}
        </span>
        <h4 style={{ margin: 0 }}>Your account</h4>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 780 }}>
        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Name</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Shown on traces you replay and keys you create.</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn btn-secondary" onClick={saveName} disabled={savingName}>{savingName ? 'Saving…' : 'Save'}</button>
            </div>
            {nameError && <span style={{ color: 'var(--color-danger)', fontSize: 12 }}>{nameError}</span>}
          </div>
        </div>

        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Email</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Your sign-in address. Only an admin can change it.</span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 12.5 }}>{user?.email}</span>
            <i className="ph ph-lock-simple" style={{ fontSize: 13, color: 'var(--c-muted)' }} />
          </div>
        </div>

        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Password</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Choose a new password for this account.</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
            <div className="field" style={{ width: '100%' }}>
              <label>Current password</label>
              <input className="input" type="password" placeholder="••••••••••" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="field" style={{ width: '100%' }}>
              <label>New password</label>
              <input className="input" type="password" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            {passwordError && <span style={{ color: 'var(--color-danger)', fontSize: 12 }}>{passwordError}</span>}
            {passwordSaved && <span style={{ color: 'var(--color-success)', fontSize: 12 }}>Password changed.</span>}
            <button className="btn btn-secondary" onClick={submitPasswordChange} disabled={changingPassword || !currentPassword || !newPassword}>
              {changingPassword ? 'Changing…' : 'Change password'}
            </button>
          </div>
        </div>

        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Appearance</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Applies to this browser only.</span>
          </div>
          <div style={{ flex: 1 }}>
            <div className="seg">
              <label className="seg-opt"><input type="radio" name="appearance" checked={preference === 'dark'} onChange={() => setPreference('dark')} />Dark</label>
              <label className="seg-opt"><input type="radio" name="appearance" checked={preference === 'light'} onChange={() => setPreference('light')} />Light</label>
              <label className="seg-opt"><input type="radio" name="appearance" checked={preference === 'system'} onChange={() => setPreference('system')} />System</label>
            </div>
          </div>
        </div>

        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Sessions</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Signed-in browsers and CLI tokens on this account.</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 9 }}>
            {sessionsError && <span style={{ color: 'var(--color-danger)', fontSize: 12 }}>{sessionsError}</span>}
            {sessions.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 11px', borderRadius: 7, background: 'var(--c-panel)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
                <i className={`ph ${SESSION_ICON[s.kind]}`} style={{ fontSize: 15, color: 'var(--color-accent-400)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                  <span style={{ fontSize: 12.5 }}>{s.deviceLabel}</span>
                  <span style={{ fontSize: 11, color: 'var(--c-text2)' }}>{s.ip} · {s.current ? 'now' : formatRelativeTime(s.lastSeenAt)} · since {formatDateTime(s.createdAt)}</span>
                </div>
                <span className={s.current ? 'tag tag-accent' : s.kind === 'cli' ? 'tag tag-outline' : 'tag tag-neutral'} style={{ marginLeft: 'auto' }}>
                  {s.current ? 'this device' : s.kind === 'cli' ? 'token' : 'active'}
                </span>
                {!s.current && (
                  <button className="btn btn-ghost btn-sm" onClick={() => signOutSession(s.id)}>Sign out</button>
                )}
              </div>
            ))}
            <button className="btn btn-secondary" onClick={signOutOthers}>
              <i className="ph ph-sign-out" />
              Sign out everywhere else
            </button>
          </div>
        </div>
      </div>

      {saved && <p style={{ position: 'fixed', bottom: 20, right: 20, color: 'var(--color-success)', fontSize: 13 }}>Saved.</p>}
    </div>
  )
}
