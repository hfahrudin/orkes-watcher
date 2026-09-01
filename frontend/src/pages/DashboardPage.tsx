import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useCurrentProject } from '../components/AppShell'
import { ProjectBreadcrumb } from '../components/ProjectBreadcrumb'
import { EmptyState } from '../components/EmptyState'
import { formatDuration } from '../lib/format'
import type { NodeStat, Run } from '../lib/types'

interface Stats {
  byOutcome: Record<Run['status'], number>
  slowestNodes: NodeStat[]
  latestTraces: Run[]
  p95ElapsedUs: number | null
  totalEdgeTraversals: number
  totalLoopReentries: number
  finishedPct: number
  hourlyBars: { ok: number; fail: number }[]
}

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

export function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = useCurrentProject()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    if (!projectId) return
    setStats(null)
    api.getProjectStats(projectId).then(setStats)
  }, [projectId])

  if (!stats) return <p className="text-muted">Loading…</p>

  const totalRuns = stats.byOutcome.running + stats.byOutcome.finished + stats.byOutcome.failed

  if (totalRuns === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <ProjectBreadcrumb project={project} />
        <EmptyState
          title="Send your first trace"
          body="Point the SDK at this project's ingest endpoint with an API key, and the first run will show up here."
          action={
            <Link className="btn btn-primary" to={`/${projectId}/keys`}>
              Get an API key
            </Link>
          }
        />
      </div>
    )
  }

  const maxBar = Math.max(...stats.hourlyBars.map((b) => b.ok + b.fail))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <ProjectBreadcrumb project={project} />
        <div className="seg" style={{ marginLeft: 'auto' }}>
          <label className="seg-opt"><input type="radio" name="dash-range" />1h</label>
          <label className="seg-opt"><input type="radio" name="dash-range" defaultChecked />24h</label>
          <label className="seg-opt"><input type="radio" name="dash-range" />7d</label>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate(`/${projectId}/keys`)}>
          <i className="ph ph-key" />
          Keys
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: 'var(--color-divider)', borderRadius: 10, overflow: 'hidden' }}>
        <StatTile label="Runs" value={String(totalRuns)} />
        <StatTile label="Finished" value={`${stats.finishedPct.toFixed(1)}%`} sub={`${stats.byOutcome.failed} failed, ${stats.byOutcome.running} running`} />
        <StatTile label="p95 elapsed" value={formatDuration(stats.p95ElapsedUs)} />
        <StatTile label="Edge traversals" value={String(stats.totalEdgeTraversals)} sub={`${(stats.totalEdgeTraversals / totalRuns).toFixed(1)} per run avg`} />
        <StatTile label="Loop re-entries" value={String(stats.totalLoopReentries)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h5 style={{ margin: 0 }}>Runs by outcome</h5>
            <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--color-text) 45%, transparent)' }}>hourly, last 24h</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 11 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-accent)' }} />finished
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-c2)' }} />failed
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 150 }}>
            {stats.hourlyBars.map((b, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, height: '100%' }}>
                <span style={{ display: 'block', height: `${(b.fail / maxBar) * 100}%`, borderRadius: '2px 2px 0 0', background: 'var(--c-c2)' }} />
                <span style={{ display: 'block', height: `${(b.ok / maxBar) * 100}%`, borderRadius: '0 0 2px 2px', background: 'linear-gradient(180deg, var(--c-accent), var(--c-c1b))' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'color-mix(in srgb, var(--color-text) 40%, transparent)' }}>
            <span>08:00</span><span>13:00</span><span>18:00</span><span>23:00</span><span>04:00</span><span>now</span>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h5 style={{ margin: 0 }}>Slowest nodes</h5>
            <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--color-text) 45%, transparent)' }}>mean per run</span>
          </div>
          {stats.slowestNodes.length === 0 ? (
            <p className="text-muted">No node timing data yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {stats.slowestNodes.map((n, i) => {
                const avg = n.totalDurationUs / n.visitCount
                const widthPct = (avg / (stats.slowestNodes[0].totalDurationUs / stats.slowestNodes[0].visitCount)) * 100
                return (
                  <div key={n.nodeId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5 }}>
                      <span className="mono" style={{ fontSize: 12 }}>{n.nodeName}</span>
                      <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'color-mix(in srgb, var(--c-text) 55%, transparent)' }}>{formatDuration(avg)}</span>
                    </div>
                    <div style={{ height: 9, borderRadius: 3, background: 'color-mix(in srgb, var(--c-text) 5%, transparent)' }}>
                      <span style={{ display: 'block', height: '100%', width: `${widthPct}%`, borderRadius: 3, background: i === 0 ? 'linear-gradient(90deg, var(--c-accent), var(--c-accent-strong))' : 'var(--c-c3)' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h5 style={{ margin: 0 }}>Latest traces</h5>
          <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--color-text) 45%, transparent)' }}>
            {stats.latestTraces.length} of {totalRuns} · click one to inspect its graph
          </span>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => navigate(`/${projectId}/traces`)}>
            All traces
            <i className="ph ph-arrow-right" />
          </button>
        </div>
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
            {stats.latestTraces.map((run) => (
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

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '14px 16px', background: 'var(--color-surface)' }}>
      <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--color-text) 48%, transparent)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 28, lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--color-text) 55%, transparent)' }}>{sub}</span>}
    </div>
  )
}
