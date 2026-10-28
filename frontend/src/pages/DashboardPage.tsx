import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useCurrentProject } from '../components/AppShell'
import { ProjectBreadcrumb } from '../components/ProjectBreadcrumb'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { formatDuration } from '../lib/format'
import { dashboardSummaryCsv, downloadFile, slug, timestampForFile } from '../lib/export'
import { DurationTrend } from '../components/dashboard/DurationTrend'
import { FailingNodes, LiveNow, TopErrors } from '../components/dashboard/RunHealth'
import type { StatsRange } from '../lib/api'
import type { Run } from '../lib/types'

const RANGES: { key: StatsRange; label: string; caption: string }[] = [
  { key: '1h', label: '1h', caption: 'every 5 min, last hour' },
  { key: '24h', label: '24h', caption: 'hourly, last 24h' },
  { key: '7d', label: '7d', caption: 'every 6h, last 7 days' },
  { key: '30d', label: '30d', caption: 'daily, last 30 days' },
]

/** Axis label for a chart bucket, at a precision that suits the range. */
function bucketLabel(iso: string, range: StatsRange): string {
  const d = new Date(iso)
  if (range === '1h' || range === '24h') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (range === '7d') return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
  const [params, setParams] = useSearchParams()
  const range = (RANGES.find((r) => r.key === params.get('range'))?.key ?? '24h') as StatsRange
  const graph = params.get('graph') ?? ''
  const [stats, setStats] = useState<api.ProjectStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const backgroundRefresh = useRef(false) // set for the timed refresh, which shouldn't dim the page
  const pageRef = useRef<HTMLDivElement>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Filters live in the URL, so a filtered dashboard can be bookmarked or shared.
  function setFilter(key: 'range' | 'graph', value: string) {
    const next = new URLSearchParams(params)
    if (value && !(key === 'range' && value === '24h')) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if (!projectId) return
    let active = true
    if (!backgroundRefresh.current) setLoading(true)
    backgroundRefresh.current = false
    setError(null)
    api
      .getProjectStats(projectId, { range, graph: graph || undefined })
      .then((s) => active && setStats(s))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Failed to load dashboard stats'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [projectId, range, graph, reloadKey])

  // Quiet refresh while the tab is visible, mainly so "Live now" stays current.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      backgroundRefresh.current = true
      setReloadKey((k) => k + 1)
    }, 15_000)
    return () => clearInterval(t)
  }, [])

  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  if (!stats) return <p className="text-muted">Loading…</p>

  const totalRuns = stats.byOutcome.running + stats.byOutcome.finished + stats.byOutcome.failed

  // No runs ever (no graph names at all): show setup help. Runs exist but none match the
  // filters: keep the dashboard and say so.
  if (stats.graphNames.length === 0) {
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

  const maxBar = Math.max(1, ...stats.timeline.map((b) => b.ok + b.fail))
  const rangeInfo = RANGES.find((r) => r.key === range)!
  // About six evenly spaced axis labels; the newest bucket is labelled 'now'.
  const labelEvery = Math.max(1, Math.round(stats.timeline.length / 6))

  const exportName = `orkes-dashboard-${slug(project?.name ?? projectId!)}-${range}${graph ? `-${slug(graph)}` : ''}-${timestampForFile()}`
  const exportMeta = { project: project?.name ?? projectId!, range, graph: graph || null, exportedAt: new Date().toISOString() }

  async function exportAs(format: 'csv' | 'json' | 'png' | 'pdf') {
    if (!stats) return
    setExportOpen(false)
    setExportError(null)
    if (format === 'csv') return downloadFile(`${exportName}.csv`, dashboardSummaryCsv(stats, exportMeta), 'text/csv;charset=utf-8')
    if (format === 'json') {
      const { project: name, exportedAt, ...filters } = exportMeta
      return downloadFile(`${exportName}.json`, JSON.stringify({ project: name, exportedAt, filters, ...stats }, null, 2), 'application/json')
    }
    if (format === 'pdf') {
      // The browser's print dialog ("Save as PDF"), using the print layout in app.css. The
      // page title becomes the suggested file name.
      const title = document.title
      document.title = exportName
      window.addEventListener('afterprint', () => (document.title = title), { once: true })
      window.print()
      return
    }
    // PNG: a 2× picture of the dashboard as shown, in the current theme, without the
    // filter and export controls.
    if (!pageRef.current) return
    setExportBusy(true)
    try {
      const { toPng } = await import('html-to-image')
      const bg = getComputedStyle(document.body).backgroundColor
      const url = await toPng(pageRef.current, {
        pixelRatio: 2,
        backgroundColor: bg,
        style: { padding: '24px', margin: '0' },
        width: pageRef.current.scrollWidth + 48,
        height: pageRef.current.scrollHeight + 48,
        filter: (el) => !(el instanceof HTMLElement && el.classList.contains('no-print')),
      })
      const a = document.createElement('a')
      a.href = url
      a.download = `${exportName}.png`
      a.click()
    } catch (e) {
      setExportError(e instanceof Error ? `Image export failed: ${e.message}` : 'Image export failed')
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <div ref={pageRef} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <ProjectBreadcrumb project={project} />
        <div className="no-print" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
          <select className="input" style={{ minHeight: 34, width: 200 }} value={graph} onChange={(e) => setFilter('graph', e.target.value)} title="Show one graph only">
            <option value="">All graphs</option>
            {stats.graphNames.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <div className="seg">
            {RANGES.map((r) => (
              <label className="seg-opt" key={r.key}>
                <input type="radio" name="dash-range" checked={range === r.key} onChange={() => setFilter('range', r.key)} />
                {r.label}
              </label>
            ))}
          </div>
        </div>
        <div className="no-print" style={{ position: 'relative' }}>
          <button className="btn btn-secondary" disabled={exportBusy} onClick={() => setExportOpen((o) => !o)} aria-haspopup="menu" aria-expanded={exportOpen} title="Export what's shown, for the current range and graph">
            <i className="ph ph-export" />
            {exportBusy ? 'Exporting…' : 'Export'}
          </button>
          {exportOpen && (
            <div className="menu" role="menu" style={{ right: 0 }} onMouseLeave={() => setExportOpen(false)}>
              <span className="menu-caption">
                {rangeInfo.caption.split(', ')[1]}{graph ? ` · ${graph}` : ' · all graphs'}
              </span>
              <button role="menuitem" onClick={() => exportAs('csv')}>
                <i className="ph ph-file-csv" /> CSV <span className="menu-hint">summary</span>
              </button>
              <button role="menuitem" onClick={() => exportAs('json')}>
                <i className="ph ph-brackets-curly" /> JSON <span className="menu-hint">all data</span>
              </button>
              <button role="menuitem" onClick={() => exportAs('png')}>
                <i className="ph ph-image" /> Image <span className="menu-hint">PNG</span>
              </button>
              <button role="menuitem" onClick={() => exportAs('pdf')}>
                <i className="ph ph-file-pdf" /> PDF <span className="menu-hint">print</span>
              </button>
            </div>
          )}
        </div>
        <button className="btn btn-secondary no-print" onClick={() => navigate(`/${projectId}/keys`)}>
          <i className="ph ph-key" />
          Keys
        </button>
      </div>
      {exportError && <p className="no-print" style={{ color: 'var(--color-danger)', fontSize: 13, margin: '-8px 0 0' }}>{exportError}</p>}
      <p className="print-only" style={{ margin: '-10px 0 0', fontSize: 12, color: 'var(--c-text-dim)' }}>
        {rangeInfo.caption.split(', ')[1]} · {graph || 'all graphs'} · exported {new Date().toLocaleString()}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: 'var(--color-divider)', borderRadius: 10, overflow: 'hidden' }}>
        <StatTile label="Runs" value={String(totalRuns)} />
        <StatTile label="Finished" value={`${stats.finishedPct.toFixed(1)}%`} sub={`${stats.byOutcome.failed} failed, ${stats.byOutcome.running} running`} />
        <StatTile label="p95 elapsed" value={formatDuration(stats.p95ElapsedUs)} />
        <StatTile label="Edge traversals" value={String(stats.totalEdgeTraversals)} sub={totalRuns ? `${(stats.totalEdgeTraversals / totalRuns).toFixed(1)} per run avg` : undefined} />
        <StatTile label="Loop re-entries" value={String(stats.totalLoopReentries)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 18 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h5 style={{ margin: 0 }}>Runs by outcome</h5>
            <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>{rangeInfo.caption}{graph && <> · <span className="mono">{graph}</span></>}</span>
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
            {stats.timeline.map((b, i) => (
              <div
                key={b.start}
                title={`${new Date(b.start).toLocaleString()}: ${b.ok} finished, ${b.fail} failed`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, height: '100%' }}
              >
                <span style={{ display: 'block', height: `${(b.fail / maxBar) * 100}%`, borderRadius: '2px 2px 0 0', background: 'var(--c-c2)' }} />
                <span style={{ display: 'block', height: `${(b.ok / maxBar) * 100}%`, borderRadius: '0 0 2px 2px', background: 'linear-gradient(180deg, var(--c-accent), var(--c-c1b))' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 5, fontSize: 10.5, color: 'var(--c-text-faint)' }}>
            {stats.timeline.map((b, i) => {
              const last = i === stats.timeline.length - 1
              const show = last || (stats.timeline.length - 1 - i) % labelEvery === 0
              return (
                <span key={b.start} style={{ flex: 1, minWidth: 0, overflow: 'visible', whiteSpace: 'nowrap', textAlign: last ? 'right' : 'center' }}>
                  {show ? (last ? 'now' : bucketLabel(b.start, range)) : ''}
                </span>
              )
            })}
          </div>
        </div>

        <LiveNow projectId={projectId!} running={stats.live.running} runningCount={stats.live.runningCount} abandonedInRange={stats.live.abandonedInRange} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 18 }}>
        <DurationTrend timeline={stats.timeline} label={(iso) => bucketLabel(iso, range)} caption={`p50 / p95, ${rangeInfo.caption}`} />

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h5 style={{ margin: 0 }}>Slowest nodes</h5>
            <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>mean per visit</span>
          </div>
          {stats.slowestNodes.length === 0 ? (
            <p className="text-muted">No node timing data yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {stats.slowestNodes.map((n, i) => {
                const avg = n.totalDurationUs / n.visitCount
                const widthPct = (avg / (stats.slowestNodes[0].totalDurationUs / stats.slowestNodes[0].visitCount)) * 100
                return (
                  <div key={n.nodeName} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5 }}>
                      <span className="mono" style={{ fontSize: 12 }}>{n.nodeName}</span>
                      <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-text-dim)' }}>{formatDuration(avg)}</span>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 18 }}>
        <TopErrors projectId={projectId!} errors={stats.topErrors} caption={`grouped by first line, ${rangeInfo.caption.split(', ')[1]}`} />
        <FailingNodes projectId={projectId!} nodes={stats.failuresByNode} withoutNode={stats.failuresWithoutNode} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h5 style={{ margin: 0 }}>Latest traces</h5>
          <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>
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
            {stats.latestTraces.length === 0 && (
              <tr style={{ cursor: 'default' }}>
                <td colSpan={10} className="text-muted" style={{ fontSize: 13, padding: '16px 4px' }}>
                  No runs {graph ? <>of <span className="mono">{graph}</span> </> : ''}in the {rangeInfo.caption.split(', ')[1]}.
                </td>
              </tr>
            )}
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
                <td style={{ textAlign: 'right', color: 'var(--c-text-faint)' }}>{new Date(run.startedAt).toLocaleTimeString()}</td>
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
      <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-faint)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 28, lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: 11.5, color: 'var(--c-text-dim)' }}>{sub}</span>}
    </div>
  )
}
