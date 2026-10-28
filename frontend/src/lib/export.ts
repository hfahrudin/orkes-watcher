// Client-side exports: build a file from data the page already has (or can page through)
// and hand it to the browser as a download.
import * as api from './api'
import type { Run } from './types'

/** Most runs one export will fetch (paged 500 at a time). */
export const MAX_EXPORT_RUNS = 10_000

export function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Safe file-name part: letters, digits, dot, dash, underscore. */
export function slug(text: string): string {
  return text.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export'
}

export function timestampForFile(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** One CSV cell. Values starting with = + - @ (or a tab/CR) are prefixed with ' so a
 * spreadsheet shows them as text instead of running them as formulas: graph names and
 * error messages come from whatever sent the trace. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Every run matching `filters`, newest first, up to MAX_EXPORT_RUNS. */
export async function fetchAllRuns(
  projectId: string,
  filters: Omit<api.RunsQuery, 'limit' | 'offset'>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ runs: Run[]; total: number; truncated: boolean }> {
  const runs: Run[] = []
  let total = 0
  for (let offset = 0; offset < MAX_EXPORT_RUNS; offset += 500) {
    const page = await api.listRunsPage(projectId, { ...filters, limit: 500, offset })
    total = page.total
    runs.push(...page.runs)
    onProgress?.(runs.length, Math.min(total, MAX_EXPORT_RUNS))
    if (page.runs.length < 500 || runs.length >= total) break
  }
  return { runs: runs.slice(0, MAX_EXPORT_RUNS), total, truncated: total > MAX_EXPORT_RUNS }
}

export const RUN_CSV_HEADER = [
  'run_id', 'graph', 'status', 'started_at', 'finished_at', 'elapsed_seconds', 'nodes', 'steps', 'loops',
  'error', 'failed_node', 'sdk_version', 'contract_version',
]

export function runToCsvRow(r: Run): unknown[] {
  return [
    r.id, r.graphName, r.status, r.startedAt, r.finishedAt ?? '',
    r.elapsedUs === null ? '' : (r.elapsedUs / 1_000_000).toFixed(3),
    r.nodeCount, r.edgeCount, r.loopCount,
    r.error ? r.error.split('\n')[0] : '', r.failedNode ?? '', r.sdkVersion ?? '', r.contractVersion ?? '',
  ]
}

/** The dashboard's figures as one spreadsheet-friendly CSV: labelled sections, each with
 * its own header row, separated by blank lines. */
export function dashboardSummaryCsv(stats: api.ProjectStats, meta: { project: string; range: string; graph: string | null; exportedAt: string }): string {
  const s = (v: number | null) => (v === null ? '' : (v / 1_000_000).toFixed(3))
  const total = stats.byOutcome.running + stats.byOutcome.finished + stats.byOutcome.failed
  const sections: [string, string[], unknown[][]][] = [
    ['Dashboard', ['field', 'value'], [['project', meta.project], ['range', meta.range], ['graph', meta.graph ?? 'all graphs'], ['exported_at', meta.exportedAt]]],
    ['Summary', ['metric', 'value'], [
      ['runs', total], ['finished', stats.byOutcome.finished], ['failed', stats.byOutcome.failed], ['running', stats.byOutcome.running],
      ['finished_pct', stats.finishedPct.toFixed(1)], ['p95_elapsed_seconds', s(stats.p95ElapsedUs)],
      ['edge_traversals', stats.totalEdgeTraversals], ['loop_reentries', stats.totalLoopReentries], ['abandoned', stats.live.abandonedInRange],
    ]],
    ['Runs over time', ['bucket_start', 'finished', 'failed', 'p50_seconds', 'p95_seconds'], stats.timeline.map((b) => [b.start, b.ok, b.fail, s(b.p50Us), s(b.p95Us)])],
    ['Slowest nodes', ['node', 'visits', 'runs', 'mean_seconds', 'total_seconds'], stats.slowestNodes.map((n) => [n.nodeName, n.visitCount, n.runCount, s(Math.round(n.totalDurationUs / n.visitCount)), s(n.totalDurationUs)])],
    ['Top errors', ['error', 'count', 'last_seen'], stats.topErrors.map((e) => [e.message, e.count, e.lastSeen])],
    ['Failures by node', ['node', 'failed_runs'], [...stats.failuresByNode.map((f) => [f.nodeName, f.count]), ...(stats.failuresWithoutNode ? [['(no node recorded)', stats.failuresWithoutNode]] : [])]],
    ['Running now', ['run_id', 'graph', 'started_at', 'last_event_at'], stats.live.running.map((r) => [r.id, r.graphName, r.startedAt, r.lastEventAt ?? ''])],
  ]
  return sections.map(([title, header, rows]) => toCsv([title], []) + toCsv(header, rows)).join('\r\n')
}
