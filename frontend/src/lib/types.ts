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
}

export interface NodeStat {
  nodeId: string
  nodeName: string
  runCount: number
  visitCount: number
  totalDurationUs: number
}

export interface FnCall {
  name: string
  args: Record<string, unknown>
  returns?: Record<string, unknown>
  durationUs: number
}

export interface NodeEvent {
  kind: 'node'
  nodeId: string
  nodeName: string
  seq: number
  visitIndex: number
  enteredAt: string
  exitedAt: string | null
}

export interface EdgeEvent {
  kind: 'edge'
  edgeId: string
  fromNode: string
  toNode: string
  // Not a closed union — the backend accepts any string here (it never branches on the
  // value, only forwards it) so a new SDK-introduced edge type doesn't break ingest. The
  // three known values below get real styling; anything else falls back to the "forward"
  // look rather than rendering invisibly. See working_context/TRACES_CONTRACT.md.
  edgeType: string
  runSeq: number
  passesLeft: number | null
  elapsedUs: number
  stateSnapshot: Record<string, unknown>
  fnCalls: FnCall[]
}

export type TraceEvent = NodeEvent | EdgeEvent

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
