// Pure helpers for orkes trace events (contract 1.0, INTEGRATION_AGREEMENT.md §2.5).
// No React, no I/O, type-only imports.
import type { EdgeEvent, GraphNode, TraceEvent, Truncated } from './types'

/** orkes's to_node when no destination was chosen (e.g. the run failed in a gate). */
export const NO_DESTINATION = 'N/A'
/** The error the watcher stores on runs that never sent run_end. */
export const ABANDONED_PREFIX = 'abandoned:'

export function isEdge(e: TraceEvent): e is EdgeEvent {
  return e.kind === 'edge'
}

export function isTruncated(v: unknown): v is Truncated {
  return typeof v === 'object' && v !== null && (v as { _truncated?: unknown })._truncated === true
}

/** Real destinations of an edge: one for forward/conditional, several for parallel, none for "N/A". */
export function destinations(e: EdgeEvent): string[] {
  const targets = Array.isArray(e.to_node) ? e.to_node : [e.to_node]
  return targets.filter((t): t is string => typeof t === 'string' && t !== NO_DESTINATION)
}

/** "__conditional__" -> "conditional". Unknown types pass through unchanged, minus dunders. */
export function edgeTypeKey(edgeType: string | null | undefined): string {
  return (edgeType ?? 'forward').replace(/^_+|_+$/g, '') || 'forward'
}

/**
 * Merges events from two sources (the live socket and GET /runs/:id/events) into one list:
 * edges deduplicated and ordered by edge_run_number, other kinds kept in arrival order after
 * them. A viewer opening a running run subscribes first, fetches second, and merges both,
 * so nothing sent in between is lost (agreement F4).
 */
export function mergeEvents(current: TraceEvent[], incoming: TraceEvent[]): TraceEvent[] {
  const edges = new Map<number, EdgeEvent>()
  const others = new Map<string, TraceEvent>() // keyed by content: socket and fetch give separate copies
  for (const e of [...current, ...incoming]) {
    if (isEdge(e)) edges.set(e.edge_run_number, e)
    else others.set(JSON.stringify(e), e)
  }
  return [...[...edges.values()].sort((a, b) => a.edge_run_number - b.edge_run_number), ...others.values()]
}

export function isAbandoned(error: string | null | undefined): boolean {
  return !!error && error.startsWith(ABANDONED_PREFIX)
}

/** First line of an orkes error ("KeyError: 'intent'") and the rest (traceback). */
export function splitError(error: string): { summary: string; detail: string } {
  const i = error.indexOf('\n')
  return i === -1 ? { summary: error, detail: '' } : { summary: error.slice(0, i), detail: error.slice(i + 1) }
}

/** Seconds -> "850µs" / "12ms" / "1.24s". orkes times are float seconds. */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—'
  if (seconds < 0.001) return `${Math.round(seconds * 1_000_000)}µs`
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  return `${seconds.toFixed(2)}s`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export interface NodeSummary {
  name: string
  description: string | null
  type: string | null
  visited: boolean
  /** Traversals leaving this node (each one is one run of the node). */
  runs: number
  /** Traversals arriving at it. */
  arrivals: number
  /** Sum of node_elapsed over its runs, seconds; null when none reported a time. */
  totalSeconds: number | null
  firstRunNumber: number | null
}

/** Per-node figures for one run, from the graph's node list plus the edges that arrived. */
export function summarizeNodes(edges: EdgeEvent[], graphNodes: GraphNode[] | null | undefined): Map<string, NodeSummary> {
  const nodes = new Map<string, NodeSummary>()
  const ensure = (name: string): NodeSummary => {
    let n = nodes.get(name)
    if (!n) {
      n = { name, description: null, type: null, visited: false, runs: 0, arrivals: 0, totalSeconds: null, firstRunNumber: null }
      nodes.set(name, n)
    }
    return n
  }
  for (const g of graphNodes ?? []) {
    const n = ensure(g.node_name)
    n.description = g.node_description
    n.type = typeof g.meta?.type === 'string' ? g.meta.type : null
  }
  for (const e of edges) {
    const source = ensure(e.from_node)
    source.visited = true
    source.runs += 1
    source.firstRunNumber = Math.min(source.firstRunNumber ?? Infinity, e.edge_run_number)
    if (typeof e.node_elapsed === 'number') source.totalSeconds = (source.totalSeconds ?? 0) + e.node_elapsed
    for (const t of destinations(e)) {
      const target = ensure(t)
      target.visited = true
      target.arrivals += 1
      target.firstRunNumber = Math.min(target.firstRunNumber ?? Infinity, e.edge_run_number)
    }
  }
  return nodes
}

/** Offset of an edge's start from the run's start, in seconds, if both are known. */
export function startOffset(e: EdgeEvent, runStartedAtIso: string): number | null {
  if (typeof e.started_at !== 'number') return null
  const runStart = Date.parse(runStartedAtIso) / 1000
  return Number.isNaN(runStart) ? null : e.started_at - runStart
}
