import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { BrandLockup } from '../components/Logo'

const STEPS = [
  { title: 'Create a project', body: 'One ingest namespace per app or environment.' },
  { title: 'Point the SDK at it', body: 'Two lines. Your graph code stays as it is.' },
  { title: 'Inspect every step', body: 'Nodes, edge types, loop passes and state snapshots per traversal.' },
]

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('fahrudinhasby12@gmail.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
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
            <h3 style={{ margin: 0 }}>Sign in</h3>
            <span style={{ fontSize: 13.5, color: 'var(--c-text2)' }}>
              Trace and inspect how your agent graphs actually execute.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>Password</label>
              <input className="input" type="password" placeholder="••••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: 0 }}>{error}</p>}
            <button className="btn btn-primary btn-block" style={{ margin: '4px 0 0' }} type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>

          <div className="auth-alt">
            <i className="ph ph-user-circle-plus" style={{ fontSize: 14, color: 'var(--c-muted)' }} />
            <span>Accounts are created by an admin. Ask yours for an activation link.</span>
          </div>

          <div className="auth-alt" style={{ fontSize: 11.5 }}>
            Demo: fahrudinhasby12@gmail.com (admin) · dev@orkes.dev (developer) · viewer@orkes.dev (viewer) — any password
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          {STEPS.map((step, i) => (
            <div className="authstep" key={step.title}>
              <span className="authnum">{i + 1}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13.5 }}>{step.title}</span>
                <span style={{ fontSize: 12, color: 'var(--c-text2)' }}>{step.body}</span>
              </div>
            </div>
          ))}
        </div>

        <pre
          className="mono"
          style={{
            padding: '13px 15px',
            borderRadius: 9,
            background: 'var(--c-code)',
            boxShadow: 'inset 0 0 0 1px var(--color-divider)',
            fontSize: 11.5,
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            color: 'color-mix(in srgb, var(--c-text) 80%, transparent)',
          }}
        >
          <span style={{ color: 'var(--c-accent-strong)' }}>from</span> orkes.watcher{' '}
          <span style={{ color: 'var(--c-accent-strong)' }}>import</span> tracer{'\n\n'}
          tracer.init(api_key=<span style={{ color: 'var(--c-c3)' }}>"ok_live_…"</span>){'\n'}
          run = tracer.run(graph, inputs)
        </pre>
      </div>
    </div>
  )
}
