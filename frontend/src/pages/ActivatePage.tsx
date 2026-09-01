import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { BrandLockup } from '../components/Logo'

export function ActivatePage() {
  const { activate } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!token) {
      setError('This activation link is missing its token.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await activate(token, password, name.trim() || undefined)
      navigate('/projects')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="authwrap">
      <div className="authcol-outer">
        <form className="authcol" onSubmit={onSubmit}>
          <div className="brand">
            <BrandLockup size={30} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 8 }}>
            <h3 style={{ margin: 0 }}>Activate your account</h3>
            <span style={{ fontSize: 13.5, color: 'var(--c-text2)' }}>
              Set a password to finish setting up the account an admin created for you.
            </span>
          </div>

          {!token && (
            <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: 0 }}>
              This link is missing its activation token. Ask an admin to resend your invite.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div className="field">
              <label>Name (optional)</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="field">
              <label>Password</label>
              <input className="input" type="password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="field">
              <label>Confirm password</label>
              <input className="input" type="password" placeholder="••••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: 0 }}>{error}</p>}
            <button className="btn btn-primary btn-block" style={{ margin: '4px 0 0' }} type="submit" disabled={busy || !token}>
              {busy ? 'Activating…' : 'Activate account'}
            </button>
          </div>
        </form>
      </div>

      <div className="authaside">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-c3)' }}>
            Open source
          </span>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 25, lineHeight: 1.25, letterSpacing: '-0.015em' }}>
            See how your agent graph actually executed.
          </span>
        </div>
      </div>
    </div>
  )
}
