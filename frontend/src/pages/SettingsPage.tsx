import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useCurrentProject } from '../components/AppShell'
import { ProjectBreadcrumb } from '../components/ProjectBreadcrumb'
import { RoleGate } from '../components/RoleGate'
import { ErrorState } from '../components/ErrorState'
import type { Project } from '../lib/types'

const RETENTION_OPTIONS = [7, 30, 90]
const SAMPLING_OPTIONS = [100, 50, 10]

export function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = useCurrentProject()
  const navigate = useNavigate()
  const [form, setForm] = useState<Project | null>(null)
  const [runCount, setRunCount] = useState(0)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function load() {
    if (!projectId) return
    setLoadError(null)
    api.getProject(projectId).then((p) => setForm(p ?? null)).catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load project'))
    api.listRuns(projectId).then((runs) => setRunCount(runs.length)).catch(() => {})
  }

  useEffect(() => {
    load()
  }, [projectId])

  if (loadError) return <ErrorState message={loadError} onRetry={load} />
  if (!form) return <p className="text-muted">Loading…</p>

  async function save(patch: Partial<Pick<Project, 'name' | 'retentionDays' | 'samplingPct'>>) {
    setSaveError(null)
    try {
      const updated = await api.updateProject(form!.id, patch)
      setForm(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save changes')
    }
  }

  async function confirmDelete() {
    setDeleteError(null)
    try {
      await api.deleteProject(form!.id)
      navigate('/projects')
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete project')
    }
  }

  const endpoint = `https://ingest.orkes.dev/v1/${form.name}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ProjectBreadcrumb project={project} pageTitle="Settings" />

      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 780 }}>
        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Project name</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Used in the SDK and in trace URLs.</span>
          </div>
          <div style={{ flex: 1, display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <RoleGate roles={['admin', 'developer']}>
              <button className="btn btn-secondary" onClick={() => save({ name: form.name })}>Save</button>
            </RoleGate>
          </div>
        </div>

        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Environment</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Set once at creation.</span>
          </div>
          <div style={{ flex: 1 }}>
            <div className="seg" style={{ opacity: 0.6, pointerEvents: 'none' }}>
              {(['production', 'staging', 'local'] as const).map((e) => (
                <label className="seg-opt" key={e}>
                  <input type="radio" name="settings-env" checked={form.env === e} readOnly />
                  {e[0].toUpperCase() + e.slice(1)}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Trace retention</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Traces older than this are deleted, state snapshots included.</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7 }}>
            <div className="seg">
              {RETENTION_OPTIONS.map((d) => (
                <label className="seg-opt" key={d}>
                  <input type="radio" name="settings-retention" checked={form.retentionDays === d} onChange={() => save({ retentionDays: d })} />
                  {d} days
                </label>
              ))}
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--c-muted)' }}>Currently storing {runCount} traces</span>
          </div>
        </div>

        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Sampling</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Drop a share of successful runs. Failures are always kept.</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7 }}>
            <div className="seg">
              {SAMPLING_OPTIONS.map((s) => (
                <label className="seg-opt" key={s}>
                  <input type="radio" name="settings-sampling" checked={form.samplingPct === s} onChange={() => save({ samplingPct: s })} />
                  {s}%
                </label>
              ))}
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--c-muted)' }}>
              {form.samplingPct === 100 ? 'You are storing every traversal of every run.' : `${100 - form.samplingPct}% of successful runs are dropped before they reach storage.`}
            </span>
          </div>
        </div>

        <div className="srow">
          <div>
            <span style={{ fontSize: 13.5 }}>Ingest endpoint</span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Where the SDK posts traces for this project.</span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px', borderRadius: 7, background: 'var(--c-code)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{endpoint}</span>
            <i className="ph ph-copy" style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--c-muted)', cursor: 'pointer' }} onClick={() => navigator.clipboard?.writeText(endpoint)} />
          </div>
        </div>

        <RoleGate roles={['admin']}>
          <div className="srow" style={{ boxShadow: 'none', paddingTop: 22 }}>
            <div>
              <span style={{ fontSize: 13.5, color: 'var(--c-accent-strong)' }}>Delete project</span>
              <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>Removes every trace and revokes its keys. Cannot be undone.</span>
            </div>
            <div style={{ flex: 1 }}>
              <button className="btn btn-secondary" onClick={() => setDeleting(true)}>
                <i className="ph ph-trash" />
                Delete {form.name}
              </button>
            </div>
          </div>
        </RoleGate>
      </div>

      {saved && <p style={{ position: 'fixed', bottom: 20, right: 20, color: 'var(--color-success)', fontSize: 13 }}>Saved.</p>}
      {saveError && <p style={{ position: 'fixed', bottom: 20, right: 20, color: 'var(--color-danger)', fontSize: 13 }}>{saveError}</p>}

      {deleting && (
        <div className="dialog-backdrop" onClick={() => setDeleting(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Delete project</div>
            <div className="dialog-body">This deletes every trace, state snapshot and key in this project. Type its name to confirm.</div>
            <div className="field">
              <label>Project name</label>
              <input className="input" placeholder={form.name} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoFocus />
            </div>
            {deleteError && <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: 0 }}>{deleteError}</p>}
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setDeleting(false)}>Cancel</button>
              <button className="btn btn-danger" disabled={confirmName !== form.name} onClick={confirmDelete}>
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
