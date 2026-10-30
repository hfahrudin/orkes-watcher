import { Link, useNavigate } from 'react-router-dom'
import { formatRelativeTime } from '../../lib/format'
import type { Run } from '../../lib/types'

const rowButton = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 8px', margin: '0 -8px', borderRadius: 6,
  border: 0, background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer',
} as const

function tracesUrl(projectId: string, filters: Record<string, string>) {
  return `/${projectId}/traces?${new URLSearchParams({ status: 'failed', ...filters })}`
}

type ErrorCategory = 'lifecycle' | 'network' | 'llm' | 'loop' | 'code' | 'other'

const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  lifecycle: 'Run lifecycle',
  network: 'Network',
  llm: 'LLM provider',
  loop: 'Loop limit',
  code: 'Code error',
  other: 'Other',
}

/** Groups an error by what kind of problem it is, from its type name and (for loop limits)
 * its message. First match wins, so the order matters. */
function categorize(kind: string | null, message: string): ErrorCategory {
  if (kind === 'Abandoned') return 'lifecycle'
  if (/max_passes/i.test(message) || kind === 'RecursionError') return 'loop'
  if (!kind) return 'other'
  if (/RateLimit|APIError|APIStatus|Authentication|PermissionDenied|Overloaded|BadRequest|OpenAI|Anthropic|Gemini|Mistral|Cohere/i.test(kind)) return 'llm'
  if (/Connection|Timeout|HTTP|Socket|SSL|DNS|Network|URL|Proxy|BrokenPipe/i.test(kind)) return 'network'
  if (/^(Value|Type|Key|Index|Attribute|ZeroDivision|Name|Assertion|NotImplemented|Lookup|Arithmetic|Overflow|Unbound|Import|ModuleNotFound|JSONDecode|Validation|Unicode\w*)Error$/.test(kind)) return 'code'
  return 'other'
}

/** Splits orkes's "<ExceptionType>: <message>" into a readable message, a type tag and its
 * category. The watcher's own "abandoned: …" error gets plain wording. */
function describeError(firstLine: string): { kind: string | null; message: string; category: ErrorCategory } {
  if (firstLine.startsWith('abandoned:')) return { kind: 'Abandoned', message: 'The run stopped sending data before finishing', category: 'lifecycle' }
  const m = /^([A-Za-z_][\w.]*)\s*:\s*(.+)$/.exec(firstLine)
  if (!m) return { kind: null, message: firstLine, category: 'other' }
  const kind = m[1].split('.').pop()!
  const raw = m[2].trim()
  return { kind, message: raw.charAt(0).toUpperCase() + raw.slice(1), category: categorize(kind, raw) }
}

/** Failed runs grouped by the first line of their error; each row opens those runs. */
export function TopErrors({ projectId, errors, caption }: { projectId: string; errors: { message: string; count: number; lastSeen: string }[]; caption: string }) {
  const navigate = useNavigate()
  return (
    <div className="card" style={{ gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <h5 style={{ margin: 0 }}>Top errors</h5>
        <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>{caption}</span>
      </div>
      {errors.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: '8px 0' }}>No failed runs in this range.</p>
      ) : (
        errors.map((e) => {
          const { kind, message, category } = describeError(e.message)
          return (
            <button
              key={e.message}
              className="hover-row"
              style={{ ...rowButton, alignItems: 'flex-start', gap: 12, padding: '9px 8px' }}
              title={`${e.message}\n\nShow these ${e.count} runs`}
              onClick={() => navigate(tracesUrl(projectId, { error: e.message }))}
            >
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span
                  style={{
                    fontSize: 13, lineHeight: 1.4, color: 'var(--c-text)',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}
                >
                  {message}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--c-text-faint)' }}>
                  {kind && (
                    <span className={`error-kind cat-${category}`} title={`${CATEGORY_LABEL[category]} · ${kind}`}>
                      {kind}
                    </span>
                  )}
                  <span>last seen {formatRelativeTime(e.lastSeen)}</span>
                </span>
              </span>
              <span className="error-count" title={`${e.count} failed ${e.count === 1 ? 'run' : 'runs'}`}>
                {e.count}
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}

/** Failed runs per node they failed in (orkes's failed_node); each bar opens those runs. */
export function FailingNodes({ projectId, nodes, withoutNode }: { projectId: string; nodes: { nodeName: string; count: number }[]; withoutNode: number }) {
  const navigate = useNavigate()
  const max = Math.max(1, ...nodes.map((n) => n.count))
  return (
    <div className="card" style={{ gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h5 style={{ margin: 0 }}>Where runs fail</h5>
        <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>failed runs per node</span>
      </div>
      {nodes.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: '8px 0' }}>{withoutNode ? 'No failure was tied to a node.' : 'No failed runs in this range.'}</p>
      ) : (
        nodes.map((n) => (
          <button key={n.nodeName} className="hover-row" style={{ ...rowButton, flexDirection: 'column', alignItems: 'stretch', gap: 4 }} title={`Show the ${n.count} runs that failed in ${n.nodeName}`} onClick={() => navigate(tracesUrl(projectId, { failedNode: n.nodeName }))}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="mono" style={{ fontSize: 12.5 }}>{n.nodeName}</span>
              <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-dim)' }}>{n.count}</span>
            </span>
            <span style={{ height: 8, borderRadius: 3, background: 'color-mix(in srgb, var(--c-text) 6%, transparent)' }}>
              <span style={{ display: 'block', height: '100%', width: `${(n.count / max) * 100}%`, borderRadius: 3, background: 'color-mix(in srgb, var(--color-danger) 75%, transparent)' }} />
            </span>
          </button>
        ))
      )}
      {withoutNode > 0 && (
        <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)', marginTop: 2 }}>
          + {withoutNode} failed {withoutNode === 1 ? 'run' : 'runs'} with no node recorded (e.g. abandoned)
        </span>
      )}
    </div>
  )
}

const QUIET_AFTER_MS = 5 * 60 * 1000

/** Runs in progress right now (any time range) and how many were abandoned in the range. */
export function LiveNow({ projectId, running, runningCount, abandonedInRange }: { projectId: string; running: Run[]; runningCount: number; abandonedInRange: number }) {
  const navigate = useNavigate()
  return (
    <div className="card" style={{ gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span className={runningCount ? 'live-dot' : undefined} style={{ width: 8, height: 8, borderRadius: '50%', background: runningCount ? 'var(--color-running, var(--c-accent))' : 'var(--c-text-faint)' }} />
        <h5 style={{ margin: 0 }}>Live now</h5>
        <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>{runningCount} running · refreshes every 15s</span>
      </div>
      {running.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: '8px 0' }}>Nothing running right now.</p>
      ) : (
        running.map((r) => {
          const last = r.lastEventAt ?? r.startedAt
          const quiet = Date.now() - Date.parse(last) > QUIET_AFTER_MS
          return (
            <button key={r.id} className="hover-row" style={rowButton} onClick={() => navigate(`/${projectId}/traces/${r.id}`)} title="Open this run">
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span className="mono" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.graphName}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-faint)' }}>{r.id.slice(0, 8)} · started {formatRelativeTime(r.startedAt)}</span>
              </span>
              <span style={{ flex: 'none', fontSize: 11.5, color: quiet ? 'var(--c-text-dim)' : 'var(--c-text-faint)' }} title={quiet ? 'No events for over 5 minutes' : undefined}>
                {quiet ? '⏸ quiet ' : ''}
                {formatRelativeTime(last)}
              </span>
            </button>
          )
        })
      )}
      {runningCount > running.length && <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>+ {runningCount - running.length} more running</span>}
      <Link
        to={`/${projectId}/traces?${new URLSearchParams({ status: 'failed', error: 'abandoned:' })}`}
        style={{ fontSize: 12, marginTop: 4, color: abandonedInRange ? 'var(--c-accent-strong)' : 'var(--c-text-faint)', pointerEvents: abandonedInRange ? 'auto' : 'none' }}
      >
        {abandonedInRange} abandoned in this range{abandonedInRange ? ' →' : ''}
      </Link>
    </div>
  )
}
