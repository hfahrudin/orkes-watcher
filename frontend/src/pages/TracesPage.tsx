import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useCurrentProject } from '../components/AppShell'
import { ProjectBreadcrumb } from '../components/ProjectBreadcrumb'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { formatDuration } from '../lib/format'
import { MAX_EXPORT_RUNS, RUN_CSV_HEADER, downloadFile, fetchAllRuns, runToCsvRow, slug, timestampForFile, toCsv } from '../lib/export'
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
const PAGE_SIZES = [25, 50, 100]

/** Time only for today's runs, date and time otherwise. */
function formatStarted(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString()
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function TracesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = useCurrentProject()
  const navigate = useNavigate()
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [total, setTotal] = useState(0)
  // Dashboard widgets link here with ?status=failed&error=… or &failedNode=…
  const [params, setParams] = useSearchParams()
  const initialStatus = params.get('status')
  const [status, setStatus] = useState<RunStatus | 'all'>(
    initialStatus === 'running' || initialStatus === 'finished' || initialStatus === 'failed' ? initialStatus : 'all',
  )
  const errorFilter = params.get('error') ?? ''
  const failedNodeFilter = params.get('failedNode') ?? ''
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // search, applied after the user stops typing
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null) // progress text while running
  const [exportNote, setExportNote] = useState<string | null>(null)

  /** Exports every run matching the current filters (all pages, not just this one). */
  async function exportRuns(format: 'csv' | 'json') {
    if (!projectId) return
    setExportOpen(false)
    setExportNote(null)
    setExporting('Exporting…')
    try {
      const { runs: all, total, truncated } = await fetchAllRuns(
        projectId,
        { status: status === 'all' ? undefined : status, search: query || undefined, error: errorFilter || undefined, failedNode: failedNodeFilter || undefined },
        (done, of) => setExporting(`Exporting ${done.toLocaleString()} / ${of.toLocaleString()}…`),
      )
      const name = `orkes-traces-${slug(project?.name ?? projectId)}${filtering ? '-filtered' : ''}-${timestampForFile()}`
      if (format === 'csv') downloadFile(`${name}.csv`, toCsv(RUN_CSV_HEADER, all.map(runToCsvRow)), 'text/csv;charset=utf-8')
      else
        downloadFile(
          `${name}.json`,
          JSON.stringify(
            {
              project: project?.name ?? projectId,
              exportedAt: new Date().toISOString(),
              filters: { status: status === 'all' ? null : status, search: query || null, error: errorFilter || null, failedNode: failedNodeFilter || null },
              total,
              runs: all,
            },
            null,
            2,
          ),
          'application/json',
        )
      if (truncated) setExportNote(`Exported the newest ${MAX_EXPORT_RUNS.toLocaleString()} of ${total.toLocaleString()} matching runs. Narrow the filters to export the rest.`)
    } catch (e) {
      setExportNote(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Any filter change starts again from the first page.
  useEffect(() => setPage(0), [projectId, status, query, pageSize, errorFilter, failedNodeFilter])

  function clearParam(key: 'error' | 'failedNode') {
    const next = new URLSearchParams(params)
    next.delete(key)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if (!projectId) return
    let active = true
    setLoading(true)
    setError(null)
    api
      .listRunsPage(projectId, {
        status: status === 'all' ? undefined : status,
        search: query || undefined,
        error: errorFilter || undefined,
        failedNode: failedNodeFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
      })
      .then(({ runs, total }) => {
        if (!active) return
        setRuns(runs)
        setTotal(total)
        // The page can fall off the end if runs were deleted meanwhile (e.g. retention).
        if (runs.length === 0 && page > 0) setPage(Math.max(0, Math.ceil(total / pageSize) - 1))
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Failed to load traces'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [projectId, status, query, page, pageSize, errorFilter, failedNodeFilter, reloadKey])

  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  if (!runs) return <p className="text-muted">Loading…</p>

  const filtering = status !== 'all' || query !== '' || errorFilter !== '' || failedNodeFilter !== ''
  if (total === 0 && !filtering) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <ProjectBreadcrumb project={project} pageTitle="Traces" />
        <EmptyState title="No traces yet" body="Runs will show up here as soon as orkes sends its first events." />
      </div>
    )
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)

  return (
    // Fills the window so the table scrolls on its own and the pager stays in view.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-primary"
              disabled={!!exporting || total === 0}
              onClick={() => setExportOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              title={filtering ? 'Export all runs matching the current filters' : 'Export all runs'}
            >
              <i className="ph ph-export" />
              {exporting ?? 'Export'}
            </button>
            {exportOpen && (
              <div className="menu" role="menu" style={{ right: 0 }} onMouseLeave={() => setExportOpen(false)}>
                <span className="menu-caption">
                  {total.toLocaleString()} {filtering ? 'matching ' : ''}{total === 1 ? 'run' : 'runs'}
                </span>
                <button role="menuitem" onClick={() => exportRuns('csv')}>
                  <i className="ph ph-file-csv" /> CSV <span className="menu-hint">spreadsheet</span>
                </button>
                <button role="menuitem" onClick={() => exportRuns('json')}>
                  <i className="ph ph-brackets-curly" /> JSON <span className="menu-hint">all fields</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 14 }}>
        {exportNote && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{exportNote}</span>}
        <span className="tag tag-outline">status: {status === 'all' ? 'any' : status}</span>
        {query && <span className="tag tag-neutral">search: {query}</span>}
        {errorFilter && (
          <button className="tag tag-neutral" style={{ border: 0, cursor: 'pointer', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => clearParam('error')} title={`error contains: ${errorFilter} (click to remove)`}>
            error: {errorFilter} ✕
          </button>
        )}
        {failedNodeFilter && (
          <button className="tag tag-neutral" style={{ border: 0, cursor: 'pointer' }} onClick={() => clearParam('failedNode')} title="click to remove">
            failed in: {failedNodeFilter} ✕
          </button>
        )}
        {filtering && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setStatus('all'); setSearch(''); setParams(new URLSearchParams(), { replace: true }) }}>
            clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-text-faint)' }}>
          {loading ? 'Loading…' : `${total} ${total === 1 ? 'trace' : 'traces'}${filtering ? ' match' : ''}`}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} title="Fetch the latest runs">
          <i className="ph ph-arrow-clockwise" />
          Refresh
        </button>
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, opacity: loading ? 0.6 : 1, transition: 'opacity 120ms' }}>
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
            {runs.map((run) => (
              <tr key={run.id} onClick={() => navigate(`/${projectId}/traces/${run.id}`)}>
                <td><span style={{ display: 'block', width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[run.status] }} /></td>
                <td className="mono" style={{ fontSize: 12.5, color: 'var(--color-accent-300)', whiteSpace: 'nowrap' }}>{run.id}</td>
                <td className="mono" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{run.graphName}</td>
                <td><span className={STATUS_TAG[run.status]}>{run.status.toUpperCase()}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{run.nodeCount}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{run.edgeCount}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{run.loopCount}</td>
                <td className="mono" style={{ textAlign: 'right', fontSize: 12.5 }}>{formatDuration(run.elapsedUs)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--c-text-faint)' }} title={new Date(run.startedAt).toLocaleString()}>
                  {formatStarted(run.startedAt)}
                </td>
                <td style={{ textAlign: 'right' }}><i className="ph ph-arrow-right" style={{ color: 'var(--color-neutral-600)' }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && <p className="text-muted" style={{ padding: '18px 4px', fontSize: 13 }}>No runs match these filters.</p>}
      </div>

      {total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 12, fontSize: 12.5, color: 'var(--c-text2)', boxShadow: 'inset 0 1px 0 var(--color-divider)', flex: 'none' }}>
          <span>
            {first}–{last} of {total}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
            per page
            <select className="input" style={{ minHeight: 28, width: 72, padding: '2px 6px' }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" disabled={page === 0 || loading} onClick={() => setPage(0)} title="First page">
              <i className="ph ph-caret-double-left" />
            </button>
            <button className="btn btn-secondary btn-sm" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
              <i className="ph ph-caret-left" />
              Previous
            </button>
            <span style={{ minWidth: 92, textAlign: 'center' }}>
              Page {page + 1} of {pageCount}
            </span>
            <button className="btn btn-secondary btn-sm" disabled={page >= pageCount - 1 || loading} onClick={() => setPage((p) => p + 1)}>
              Next
              <i className="ph ph-caret-right" />
            </button>
            <button className="btn btn-secondary btn-sm" disabled={page >= pageCount - 1 || loading} onClick={() => setPage(pageCount - 1)} title="Last page">
              <i className="ph ph-caret-double-right" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
