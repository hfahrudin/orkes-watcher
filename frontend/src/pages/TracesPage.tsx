import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/mockApi'
import { useCurrentProject } from '../components/AppShell'
import { ProjectBreadcrumb } from '../components/ProjectBreadcrumb'
import { EmptyState } from '../components/EmptyState'
import { formatDuration } from '../lib/format'
import type { Run, RunStatus } from '../lib/types'

const STATUS_DOT: Record<Run['status'], string> = {
  finished: 'var(--c-accent)',
  failed: 'var(--c-c2)',
  running: 'var(--c-accent-strong)',
}
const STATUS_TAG: Record<Run['status'], string> = {
  finished: 'tag tag-accent',
  failed: 'tag tag-outline',
  running: 'tag tag-neutral',
}

export function TracesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = useCurrentProject()
  const navigate = useNavigate()
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [status, setStatus] = useState<RunStatus | 'all'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!projectId) return
    setRuns(null)
    api.listRuns(projectId).then(setRuns)
  }, [projectId])

  const filtered = useMemo(() => {
    if (!runs) return []
    return runs.filter((r) => {
      if (status !== 'all' && r.status !== status) return false
      if (search && !r.id.includes(search) && !r.graphName.includes(search)) return false
      return true
    })
  }, [runs, status, search])

  if (!runs) return <p className="text-muted">Loading…</p>

  if (runs.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <ProjectBreadcrumb project={project} pageTitle="Traces" />
        <EmptyState title="No traces yet" body="Runs will show up here as soon as the SDK sends its first events." />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 12 }}>
        <ProjectBreadcrumb project={project} pageTitle="Traces" />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="input" style={{ width: 220 }} placeholder="run id, graph…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="seg">
            {(['all', 'running', 'finished', 'failed'] as const).map((s) => (
              <label className="seg-opt" key={s}>
                <input type="radio" name="traces-status" checked={status === s} onChange={() => setStatus(s)} />
                {s === 'all' ? 'any' : s}
              </label>
            ))}
          </div>
          <button className="btn btn-primary">
            <i className="ph ph-export" />
            Export
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 14 }}>
        <span className="tag tag-outline">status: {status === 'all' ? 'any' : status}</span>
        {search && <span className="tag tag-neutral">search: {search}</span>}
        {(status !== 'all' || search) && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setStatus('all'); setSearch('') }}>
            clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'color-mix(in srgb, var(--color-text) 45%, transparent)' }}>
          {filtered.length} of {runs.length} traces · live tail
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--c-accent-strong)', marginLeft: 6 }} />
        </span>
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 26 }}></th>
              <th>Run ID</th>
              <th>Graph</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Nodes</th>
              <th style={{ textAlign: 'right' }}>Steps</th>
              <th style={{ textAlign: 'right' }}>Loops</th>
              <th style={{ textAlign: 'right' }}>Elapsed</th>
              <th style={{ textAlign: 'right' }}>Started</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((run) => (
              <tr key={run.id} onClick={() => navigate(`/${projectId}/traces/${run.id}`)}>
                <td><span style={{ display: 'block', width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[run.status] }} /></td>
                <td className="mono" style={{ fontSize: 12.5, color: 'var(--color-accent-300)', whiteSpace: 'nowrap' }}>{run.id}</td>
                <td className="mono" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{run.graphName}</td>
                <td><span className={STATUS_TAG[run.status]}>{run.status.toUpperCase()}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{run.nodeCount}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{run.edgeCount}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{run.loopCount}</td>
                <td className="mono" style={{ textAlign: 'right', fontSize: 12.5 }}>{formatDuration(run.elapsedUs)}</td>
                <td style={{ textAlign: 'right', color: 'color-mix(in srgb, var(--c-text) 45%, transparent)' }}>{new Date(run.startedAt).toLocaleTimeString()}</td>
                <td style={{ textAlign: 'right' }}><i className="ph ph-arrow-right" style={{ color: 'var(--color-neutral-600)' }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
