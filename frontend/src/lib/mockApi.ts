import * as seed from './mockData'
import type { ApiKey, Member, NodeStat, Project, Run, Session, TraceEvent, User } from './types'

const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms))

// mutable in-memory copies so create/revoke/etc. feel real across a session
let _projects = [...seed.projects]
let _apiKeys = [...seed.apiKeys]
let _members = [...seed.members]
let _sessions = [...seed.sessions]
const _runs = [...seed.runs]

export async function login(email: string, _password: string): Promise<User> {
  await delay(350)
  const user = seed.users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!user) throw new Error('No account found for that email.')
  return user
}

export async function listProjects(): Promise<Project[]> {
  await delay()
  return _projects
}

export async function getProject(id: string): Promise<Project | undefined> {
  await delay()
  return _projects.find((p) => p.id === id)
}

export async function createProject(input: Pick<Project, 'name' | 'env'>): Promise<Project> {
  await delay(400)
  const project: Project = {
    id: `p_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    env: input.env,
    retentionDays: 30,
    samplingPct: 100,
    createdAt: new Date().toISOString(),
  }
  _projects = [..._projects, project]
  return project
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'retentionDays' | 'samplingPct'>>): Promise<Project> {
  await delay(300)
  _projects = _projects.map((p) => (p.id === id ? { ...p, ...patch } : p))
  return _projects.find((p) => p.id === id)!
}

export async function deleteProject(id: string): Promise<void> {
  await delay(400)
  _projects = _projects.filter((p) => p.id !== id)
}

export async function listRuns(projectId: string): Promise<Run[]> {
  await delay()
  return _runs.filter((r) => r.projectId === projectId).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

export async function getRun(id: string): Promise<Run | undefined> {
  await delay()
  return _runs.find((r) => r.id === id)
}

/** Postgres-only aggregate read — never touches a trace blob, per DATABASE.md. */
export async function getProjectStats(projectId: string) {
  await delay(300)
  const projectRuns = _runs.filter((r) => r.projectId === projectId)
  const byOutcome: Record<Run['status'], number> = { running: 0, finished: 0, failed: 0 }
  for (const r of projectRuns) byOutcome[r.status]++
  const slowestNodes: NodeStat[] = (seed.nodeStatsByProject[projectId] ?? []).slice(0, 6)
  const latestTraces = [...projectRuns].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 5)

  const finishedOrFailed = projectRuns.filter((r) => r.elapsedUs !== null)
  const sortedElapsed = finishedOrFailed.map((r) => r.elapsedUs!).sort((a, b) => a - b)
  const p95ElapsedUs = sortedElapsed.length ? sortedElapsed[Math.floor(sortedElapsed.length * 0.95)] ?? sortedElapsed[sortedElapsed.length - 1] : null
  const totalEdgeTraversals = projectRuns.reduce((sum, r) => sum + r.edgeCount, 0)
  const totalLoopReentries = projectRuns.reduce((sum, r) => sum + r.loopCount, 0)
  const finishedPct = projectRuns.length ? (byOutcome.finished / projectRuns.length) * 100 : 0

  // No time-series aggregation table exists yet — this is an illustrative hourly shape,
  // not a real query result (there's nothing in DATABASE.md's schema to back it with today).
  const hourlyBars = [11, 14, 19, 24, 31, 38, 44, 52, 61, 58, 66, 72, 69, 77, 84, 79, 88, 74, 66, 57, 48, 39, 28, 21].map((v, n) => ({
    ok: v,
    fail: n === 8 || n === 16 ? 12 : n % 5 === 0 ? 5 : 3,
  }))

  return { byOutcome, slowestNodes, latestTraces, p95ElapsedUs, totalEdgeTraversals, totalLoopReentries, finishedPct, hourlyBars }
}

/**
 * GET /runs/:id/events. Per DATABASE.md this is a dual-source read: a running trace's
 * events come from the in-memory buffer (here: the mock live emitter's accumulated state),
 * a finished/failed trace's events come from its MinIO blob (here: the static seed).
 */
export async function getRunEvents(runId: string): Promise<TraceEvent[]> {
  await delay(250)
  return seed.traceEventsByRunId[runId] ?? []
}

export async function listApiKeys(projectId: string): Promise<ApiKey[]> {
  await delay()
  return _apiKeys.filter((k) => k.projectId === projectId)
}

export async function createApiKey(projectId: string, label: string, scope: ApiKey['scope']): Promise<{ key: ApiKey; secret: string }> {
  await delay(400)
  const prefix = `ok_${scope === 'ingest' ? 'live' : 'read'}_${Math.random().toString(36).slice(2, 6)}`
  const key: ApiKey = {
    id: `k_${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    label,
    prefix,
    scope,
    createdBy: 'u_1',
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  }
  _apiKeys = [..._apiKeys, key]
  return { key, secret: `${prefix}_${Math.random().toString(36).slice(2, 18)}` }
}

export async function revokeApiKey(id: string): Promise<void> {
  await delay(300)
  _apiKeys = _apiKeys.map((k) => (k.id === id ? { ...k, scope: 'revoked' } : k))
}

export async function listMembers(projectId: string): Promise<Member[]> {
  await delay()
  return _members.filter((m) => m.projectId === projectId)
}

export async function inviteMember(projectId: string, email: string, role: Member['role']): Promise<Member> {
  await delay(350)
  const member: Member = { userId: `u_${Math.random().toString(36).slice(2, 8)}`, projectId, name: email.split('@')[0], email, role }
  _members = [..._members, member]
  return member
}

export async function updateMemberRole(projectId: string, userId: string, role: Member['role']): Promise<void> {
  await delay(300)
  _members = _members.map((m) => (m.projectId === projectId && m.userId === userId ? { ...m, role } : m))
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  await delay(300)
  _members = _members.filter((m) => !(m.projectId === projectId && m.userId === userId))
}

export async function listSessions(): Promise<Session[]> {
  await delay()
  return _sessions
}

export async function revokeSession(id: string): Promise<void> {
  await delay(250)
  _sessions = _sessions.filter((s) => s.id !== id || s.current)
}

export async function revokeOtherSessions(): Promise<void> {
  await delay(250)
  _sessions = _sessions.filter((s) => s.current)
}

// --- live gateway simulation --------------------------------------------
// Stands in for `WS /runs/:id/live`. Only run_running_1 has a live tail scripted;
// anything else just never emits, matching a finished/failed run's socket never opening.

type LiveHandler = (event: TraceEvent) => void
type DoneHandler = (finalStatus: 'finished' | 'failed') => void

const LIVE_TAIL: TraceEvent[] = [
  { kind: 'edge', edgeId: 'e_retrieve_search_live', fromNode: 'retrieve', toNode: 'tool_search', edgeType: 'parallel', runSeq: 5, passesLeft: null, elapsedUs: 610_000, stateSnapshot: { intent: 'analytics' }, fnCalls: [] },
  { kind: 'node', nodeId: 'tool_search', nodeName: 'Search docs', seq: 6, visitIndex: 1, enteredAt: new Date().toISOString(), exitedAt: null },
  { kind: 'edge', edgeId: 'e_search_merge_live', fromNode: 'tool_search', toNode: 'merge', edgeType: 'forward', runSeq: 7, passesLeft: null, elapsedUs: 540_000, stateSnapshot: { docs: ['refunds.md'] }, fnCalls: [{ name: 'search_docs', args: { query: 'refund cases last week' }, durationUs: 540_000 }] },
  { kind: 'node', nodeId: 'merge', nodeName: 'Merge results', seq: 8, visitIndex: 1, enteredAt: new Date().toISOString(), exitedAt: null },
  { kind: 'edge', edgeId: 'e_merge_answer_live', fromNode: 'merge', toNode: 'answer', edgeType: 'conditional', runSeq: 9, passesLeft: null, elapsedUs: 90_000, stateSnapshot: { confidence: 0.88 }, fnCalls: [] },
  { kind: 'node', nodeId: 'answer', nodeName: 'Draft answer', seq: 10, visitIndex: 1, enteredAt: new Date().toISOString(), exitedAt: null },
  { kind: 'edge', edgeId: 'e_answer_end_live', fromNode: 'answer', toNode: 'END', edgeType: 'forward', runSeq: 11, passesLeft: null, elapsedUs: 700_000, stateSnapshot: { answer: 'Here is a summary of last week’s refund cases: 12 total, 9 approved, 3 pending review.' }, fnCalls: [{ name: 'draft_answer', args: {}, durationUs: 700_000 }] },
  { kind: 'node', nodeId: 'END', nodeName: 'End', seq: 12, visitIndex: 1, enteredAt: new Date().toISOString(), exitedAt: new Date().toISOString() },
]

export function subscribeToLiveRun(runId: string, onEvent: LiveHandler, onDone: DoneHandler): () => void {
  if (runId !== 'run_running_1') return () => {}

  let i = 0
  const timer = setInterval(() => {
    if (i >= LIVE_TAIL.length) {
      clearInterval(timer)
      onDone('finished')
      return
    }
    onEvent(LIVE_TAIL[i])
    i++
  }, 1400)

  return () => clearInterval(timer)
}
