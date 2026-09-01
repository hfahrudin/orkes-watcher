import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { RoleGate } from '../components/RoleGate'
import { useAuth } from '../lib/auth'
import type { Member, Role } from '../lib/types'

const ROLE_TAG: Record<Role, string> = { admin: 'tag tag-accent', developer: 'tag tag-neutral', viewer: 'tag tag-outline' }
const ROLE_CARDS: { role: Role; name: string; can: string }[] = [
  { role: 'admin', name: 'Admin', can: 'Create projects and user accounts, manage keys, remove members.' },
  { role: 'developer', name: 'Developer', can: 'Read traces, replay runs, create ingest keys for this project.' },
  { role: 'viewer', name: 'Viewer', can: 'Read the dashboard and trace log. No keys, no replay.' },
]

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
}

function activationLink(token: string) {
  return `${window.location.origin}/activate?token=${token}`
}

export function MembersPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { hasRole } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('developer')
  const [defaultRole, setDefaultRole] = useState<Role>('developer')
  const [activationDialog, setActivationDialog] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    api.listMembers(projectId).then(setMembers).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load members'))
  }, [projectId])

  async function invite() {
    if (!projectId || !email.trim()) return
    setError(null)
    try {
      const { member, activationToken } = await api.inviteMember(projectId, email.trim(), role)
      setMembers((m) => [...m, member])
      setInviting(false)
      setEmail('')
      if (activationToken) setActivationDialog(activationLink(activationToken))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create user')
    }
  }

  async function resendActivation(userId: string) {
    if (!projectId) return
    setError(null)
    try {
      const { activationToken } = await api.resendActivation(projectId, userId)
      if (activationToken) setActivationDialog(activationLink(activationToken))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resend activation link')
    }
  }

  async function changeRole(userId: string, newRole: Role) {
    if (!projectId) return
    setError(null)
    try {
      await api.updateMemberRole(projectId, userId, newRole)
      setMembers((m) => m.map((mem) => (mem.userId === userId ? { ...mem, role: newRole } : mem)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change role')
    }
  }

  async function remove(userId: string) {
    if (!projectId) return
    setError(null)
    try {
      await api.removeMember(projectId, userId)
      setMembers((m) => m.filter((mem) => mem.userId !== userId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member')
    }
  }

  function copyLink(link: string) {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const counts = ROLE_CARDS.map((c) => ({ ...c, count: members.filter((m) => m.role === c.role).length }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h4 style={{ margin: 0 }}>Access</h4>
          <span style={{ fontSize: 12.5, color: 'color-mix(in srgb, var(--color-text) 52%, transparent)' }}>
            Accounts are created here by an admin. Roles apply to this project.
          </span>
        </div>
        <RoleGate roles={['admin']}>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setInviting(true)}>
            <i className="ph ph-user-plus" />
            Create user
          </button>
        </RoleGate>
      </div>

      {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: 0 }}>{error}</p>}

      <RoleGate roles={['admin']}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 15px', borderRadius: 9, background: 'var(--c-panel)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35 }}>
            <span style={{ fontSize: 13 }}>Default role for new accounts</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Preselected in the Create user dialog.</span>
          </div>
          <div className="seg" style={{ marginLeft: 'auto' }}>
            <label className="seg-opt"><input type="radio" name="default-role" checked={defaultRole === 'developer'} onChange={() => setDefaultRole('developer')} />Developer</label>
            <label className="seg-opt"><input type="radio" name="default-role" checked={defaultRole === 'viewer'} onChange={() => setDefaultRole('viewer')} />Viewer</label>
          </div>
        </div>
      </RoleGate>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {counts.map((c) => (
          <div className="card elev-sm" style={{ gap: 6, padding: '13px 15px' }} key={c.role}>
            <span className="card-kicker">{c.count} {c.count === 1 ? 'person' : 'people'}</span>
            <span className="card-title" style={{ fontSize: 15 }}>{c.name}</span>
            <span className="card-body" style={{ fontSize: 12 }}>{c.can}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h5 style={{ margin: 0 }}>Members</h5>
          <span style={{ fontSize: 12, color: 'color-mix(in srgb, var(--color-text) 45%, transparent)' }}>{members.length} on this project</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} style={{ cursor: 'default' }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 26, height: 26, flex: 'none', borderRadius: '50%', background: 'var(--color-accent-800)', display: 'grid', placeItems: 'center', fontSize: 10.5, color: 'var(--color-accent-100)' }}>
                      {initials(m.name)}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                      <span>{m.name}</span>
                      <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--c-text) 45%, transparent)' }}>{m.email}</span>
                    </div>
                  </div>
                </td>
                <td>
                  {hasRole('admin') ? (
                    <select className="input" style={{ minHeight: 30, width: 130 }} value={m.role} onChange={(e) => changeRole(m.userId, e.target.value as Role)}>
                      <option value="admin">Admin</option>
                      <option value="developer">Developer</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className={ROLE_TAG[m.role]}>{m.role}</span>
                  )}
                </td>
                <td>
                  <span className={m.status === 'invited' ? 'tag tag-outline' : 'tag tag-neutral'}>{m.status}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <RoleGate roles={['admin']}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {m.status === 'invited' && (
                        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => resendActivation(m.userId)}>Resend link</button>
                      )}
                      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => remove(m.userId)}>Remove</button>
                    </div>
                  </RoleGate>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inviting && (
        <div className="dialog-backdrop" onClick={() => setInviting(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Create user</div>
            <div className="dialog-body">Creates the account and generates a one-time activation link you send them yourself.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label>Email</label>
                <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="name@company.com" />
              </div>
              <div className="field">
                <label>Role</label>
                <div className="seg">
                  <label className="seg-opt"><input type="radio" name="invite-role" checked={role === 'admin'} onChange={() => setRole('admin')} />Admin</label>
                  <label className="seg-opt"><input type="radio" name="invite-role" checked={role === 'developer'} onChange={() => setRole('developer')} />Developer</label>
                  <label className="seg-opt"><input type="radio" name="invite-role" checked={role === 'viewer'} onChange={() => setRole('viewer')} />Viewer</label>
                </div>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setInviting(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={invite}>Create user</button>
            </div>
          </div>
        </div>
      )}

      {activationDialog && (
        <div className="dialog-backdrop" onClick={() => setActivationDialog(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Activation link</div>
            <p className="dialog-body">There's no email sending yet — copy this link and send it to them yourself. It expires in 7 days.</p>
            <pre className="raw-json" style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{activationDialog}</pre>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => copyLink(activationDialog)}>{copied ? 'Copied' : 'Copy link'}</button>
              <button className="btn btn-primary" onClick={() => setActivationDialog(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
