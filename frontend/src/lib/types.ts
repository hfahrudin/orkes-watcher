export type Role = 'admin' | 'developer' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  status: 'active' | 'invited'
}

export interface Project {
  id: string
  name: string
  env: 'production' | 'staging' | 'local'
  retentionDays: number
  samplingPct: number
  /** A running run with no new batch for this long is marked failed ("abandoned"). */
  abandonAfterMinutes: number
  createdAt: string
}

export type RunStatus = 'running' | 'finished' | 'failed'

export interface Run {
  id: string
  projectId: string
  graphName: string
  status: RunStatus
  startedAt: string
  finishedAt: string | null
  nodeCount: number
  edgeCount: number
  loopCount: number
  elapsedUs: number | null
  error: string | null
  failedNode: string | null
  graphDescription: string | null
  contractVersion: string | null
  sdkVersion: string | null
  /** Only on GET /runs/:id. The graph's full node list from orkes, or null if the batch
   * carrying it was lost — then nodes are inferred from the edges. */
  graphNodes?: GraphNode[] | null
}

export interface NodeStat {
  nodeName: string
  runCount: number
  visitCount: number
  totalDurationUs: number
}

// --- orkes trace events -------------------------------------------------------
// Trace contract 1.0 (working_context/INTEGRATION_AGREEMENT.md §2.4–2.5). These come back
// from the API exactly as orkes sent them, so they're snake_case, unlike the rest of this
// file, and times are in seconds.

/** What orkes's sink puts in place of a field that was too large to send. */
export interface Truncated {
  _truncated: true
  size: number
}
export type MaybeTruncated<T> = T | Truncated

export interface GraphNode {
  node_id: string
  node_name: string
  node_description: string | null
  meta: Record<string, unknown>
}

export interface FunctionTrace {
  function_name: string
  input_args: unknown[]
  input_kwargs: Record<string, unknown>
  return_value: unknown
  elapsed: number
}

export interface LLMMessage {
  role: string
  content: unknown
}

export interface LLMTrace {
  messages: { messages: LLMMessage[] } | LLMMessage[]
  tools: unknown
  parsed_response: { content_type?: string; content: unknown } | null
  model: string
  settings: Record<string, unknown> | null
}

export interface EdgeEvent {
  kind: 'edge'
  /** Same id on every traversal of one structural edge, so a repeat is a loop pass. */
  edge_id: string
  /** Starts at 1, unique per run: the ordering and selection key. */
  edge_run_number: number
  from_node: string
  /** A list for parallel edges; "N/A" when no destination was chosen. */
  to_node: string | string[]
  /** "__forward__" / "__conditional__" / "__parallel__", not a closed set. */
  edge_type: string | null
  passes_left?: number | null
  /** Unix seconds. */
  started_at?: number | null
  /** Seconds: the source node plus its gate (conditional) or all branches (parallel). */
  elapsed: number
  /** Seconds in the source node's function only. */
  node_elapsed?: number | null
  state_snapshot: MaybeTruncated<Record<string, unknown>>
  meta: MaybeTruncated<Record<string, unknown>>
  function_traces: MaybeTruncated<FunctionTrace[]>
  llm_traces: MaybeTruncated<LLMTrace[]>
}

/** An event kind from a newer orkes; kept and shown raw, never counted. */
export interface OtherEvent {
  kind: string
  [field: string]: unknown
}

export type TraceEvent = EdgeEvent | OtherEvent

export interface WatcherVersion {
  watcher_version: string
  contract: { supported_majors: number[]; latest: string }
}

export interface ApiKey {
  id: string
  projectId: string
  label: string
  prefix: string
  scope: 'ingest' | 'read' | 'revoked'
  createdBy: string
  lastUsedAt: string | null
  createdAt: string
}

export interface Member {
  userId: string
  projectId: string
  name: string
  email: string
  role: Role
  status: 'active' | 'invited'
}

export interface Session {
  id: string
  kind: 'browser' | 'cli'
  deviceLabel: string
  ip: string
  createdAt: string
  lastSeenAt: string
  current: boolean
}
