import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as api from '../lib/mockApi'
import { useCurrentProject } from '../components/AppShell'
import { RoleGate } from '../components/RoleGate'
import { formatRelativeTime } from '../lib/format'
import type { ApiKey } from '../lib/types'

const SCOPE_TAG: Record<ApiKey['scope'], string> = {
  ingest: 'tag tag-accent',
  read: 'tag tag-neutral',
  revoked: 'tag tag-outline',
}

const CREATED_BY_NAME: Record<string, string> = {
  u_1: 'Hasby F.',
  u_2: 'Dana P.',
  u_3: 'Rian S.',
}

export function KeysPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = useCurrentProject()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [creating, setCreating] = useState(false)
  const [label, setLabel] = useState('')
  const [scope, setScope] = useState<'ingest' | 'read'>('ingest')
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    if (!projectId) return
    api.listApiKeys(projectId).then(setKeys)
  }, [projectId])

  async function create() {
    if (!projectId || !label.trim()) return
    const { key, secret } = await api.createApiKey(projectId, label.trim(), scope)
    setKeys((k) => [...k, key])
    setNewSecret(secret)
    setCreating(false)
    setLabel('')
  }

  async function revoke(id: string) {
    await api.revokeApiKey(id)
    setKeys((k) => k.map((key) => (key.id === id ? { ...key, scope: 'revoked' } : key)))
  }

  async function verifyIngest() {
    if (!projectId) return
    setVerifying(true)
    const runs = await api.listRuns(projectId)
    setVerifying(false)
    setVerified(runs.length > 0)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h4 style={{ margin: 0 }}>API keys</h4>
          <span style={{ fontSize: 12.5, color: 'color-mix(in srgb, var(--color-text) 52%, transparent)' }}>
            Every key is scoped to this project. Traces sent with a key land here.
          </span>
        </div>
        <RoleGate roles={['admin', 'developer']}>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>
            <i className="ph ph-key" />
            Create key
          </button>
        </RoleGate>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Key</th>
            <th>Scope</th>
            <th>Created by</th>
            <th>Last used</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} style={{ cursor: 'default' }}>
              <td>{k.label}</td>
              <td className="mono" style={{ fontSize: 12.5, color: 'color-mix(in srgb, var(--c-text) 62%, transparent)', whiteSpace: 'nowrap' }}>{k.prefix}••••</td>
              <td><span className={SCOPE_TAG[k.scope]}>{k.scope}</span></td>
              <td style={{ color: 'color-mix(in srgb, var(--c-text) 62%, transparent)' }}>{CREATED_BY_NAME[k.createdBy] ?? k.createdBy}</td>
              <td style={{ color: 'color-mix(in srgb, var(--c-text) 55%, transparent)' }}>{k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : 'never'}</td>
              <td style={{ textAlign: 'right' }}>
                <RoleGate roles={['admin', 'developer']}>
                  {k.scope !== 'revoked' && (
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => revoke(k.id)}>Revoke</button>
                  )}
                </RoleGate>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', paddingTop: 4 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <h5 style={{ margin: 0 }}>Send your first trace</h5>
          <span style={{ fontSize: 12.5, color: 'color-mix(in srgb, var(--color-text) 58%, transparent)' }}>
            Wrap the graph you already build. Every node entry, edge traversal and state snapshot is recorded under the key's project and shows up in the trace log.
          </span>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn btn-secondary">
              <i className="ph ph-book-open" />
              Docs
            </button>
            <button className="btn btn-ghost" onClick={verifyIngest} disabled={verifying}>
              {verifying ? 'Checking…' : 'Verify ingest'}
            </button>
          </div>
          {verified && <span style={{ color: 'var(--color-success)', fontSize: 12.5 }}>A trace was received for this project.</span>}
        </div>
        <pre className="mono" style={{ flex: 1.2, padding: '14px 16px', borderRadius: 10, background: 'var(--c-code)', boxShadow: 'inset 0 0 0 1px var(--color-divider)', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'color-mix(in srgb, var(--c-text) 80%, transparent)' }}>
          <span style={{ color: 'var(--color-neutral-600)' }}># pip install orkes-observe{'\n'}</span>
          <span style={{ color: 'var(--color-accent-300)' }}>from</span> orkes.watcher <span style={{ color: 'var(--color-accent-300)' }}>import</span> tracer{'\n\n'}
          tracer.init({'\n'}
          {'    '}api_key=<span style={{ color: 'var(--c-accent-strong)' }}>"ok_live_9f31…"</span>,{'\n'}
          {'    '}project=<span style={{ color: 'var(--c-accent-strong)' }}>"{project?.name ?? 'my-project'}"</span>,{'\n'}
          ){'\n\n'}
          graph = build_graph(){'\n'}
          run = tracer.run(graph, inputs) <span style={{ color: 'var(--color-neutral-600)' }}># traced</span>
        </pre>
      </div>

      {creating && (
        <div className="dialog-backdrop" onClick={() => setCreating(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Create API key</div>
            <div className="dialog-body">The full key is shown once. Store it in your deploy secrets.</div>
            <div className="field">
              <label>Label</label>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus placeholder="prod worker" />
            </div>
            <div className="field">
              <label>Scope</label>
              <div className="seg">
                <label className="seg-opt"><input type="radio" name="key-scope" checked={scope === 'ingest'} onChange={() => setScope('ingest')} />Ingest</label>
                <label className="seg-opt"><input type="radio" name="key-scope" checked={scope === 'read'} onChange={() => setScope('read')} />Read</label>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={create}>Create key</button>
            </div>
          </div>
        </div>
      )}

      {newSecret && (
        <div className="dialog-backdrop" onClick={() => setNewSecret(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Key created</div>
            <p className="dialog-body">This secret is shown once and never again — copy it now.</p>
            <pre className="raw-json">{newSecret}</pre>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={() => setNewSecret(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
