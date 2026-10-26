import type { ApiKey, Member, NodeStat, Project, Run, Session, TraceEvent, User, WatcherVersion } from './types'

declare global {
  interface Window {
    /** Injected at container *start* by docker-entrypoint.sh — see frontend/docker/. */
    __ORKES_CONFIG__?: { API_URL?: string }
  }
}

// Runtime-injected value takes priority (the real path, in Docker); import.meta.env is a
// build-time Vite fallback for plain `npm run dev` without the entrypoint script at all.
// Also the `base_url` an orkes WatcherSink sends traces to (shown on the Settings page).
export const API_BASE = window.__ORKES_CONFIG__?.API_URL || import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

interface RequestOptions extends RequestInit {
  /** Set for the initial "am I already logged in?" check — a 401 there is an expected,
   * benign outcome (not logged in yet), not a session that expired mid-use, so it
   * shouldn't trigger the global hard-redirect below. */
  suppressAuthRedirect?: boolean
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (res.status === 401 && !init?.suppressAuthRedirect) {
    // Session expired or was never established — bounce to login rather than let every
    // call site handle this individually.
    window.location.href = '/login'
    throw new ApiError(401, 'Not signed in')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = typeof body?.detail === 'string' ? body.detail : Array.isArray(body?.detail) ? body.detail.map((d: { msg: string }) => d.msg).join('; ') : res.statusText
    throw new ApiError(res.status, message)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T
  return res.json() as Promise<T>
}

async function getOrUndefined<T>(path: string): Promise<T | undefined> {
  try {
    return await request<T>(path)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return undefined
    throw e
  }
}

export async function login(email: string, password: string): Promise<User> {
  return request<User>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }), suppressAuthRedirect: true })
}

export async function activateAccount(token: string, password: string, name?: string): Promise<User> {
  return request<User>('/auth/activate', { method: 'POST', body: JSON.stringify({ token, password, name }), suppressAuthRedirect: true })
}

export async function updateProfile(name: string): Promise<User> {
  return request<User>('/me', { method: 'PATCH', body: JSON.stringify({ name }) })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request<void>('/me/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
}

export async function logout(): Promise<void> {
  await request<void>('/auth/logout', { method: 'POST' })
}

export async function me(): Promise<User | null> {
  try {
    return await request<User>('/me', { suppressAuthRedirect: true })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

export async function listProjects(): Promise<Project[]> {
  return request<Project[]>('/projects')
}

export async function getProject(id: string): Promise<Project | undefined> {
  return getOrUndefined<Project>(`/projects/${id}`)
}

export async function createProject(input: Pick<Project, 'name' | 'env'>): Promise<Project> {
  return request<Project>('/projects', { method: 'POST', body: JSON.stringify(input) })
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'retentionDays' | 'samplingPct' | 'abandonAfterMinutes'>>): Promise<Project> {
  return request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export async function deleteProject(id: string): Promise<void> {
  await request<void>(`/projects/${id}`, { method: 'DELETE' })
}

export async function listRuns(projectId: string): Promise<Run[]> {
  return request<Run[]>(`/projects/${projectId}/runs`)
}

export async function getRun(id: string): Promise<Run | undefined> {
  return getOrUndefined<Run>(`/runs/${id}`)
}

interface ProjectStats {
  byOutcome: Record<Run['status'], number>
  slowestNodes: NodeStat[]
  latestTraces: Run[]
  p95ElapsedUs: number | null
  totalEdgeTraversals: number
  totalLoopReentries: number
  finishedPct: number
  hourlyBars: { ok: number; fail: number }[]
}

export async function getProjectStats(projectId: string): Promise<ProjectStats> {
  return request<ProjectStats>(`/projects/${projectId}/stats`)
}

/** Trace events exactly as orkes sent them (snake_case), ordered by edge_run_number. */
export async function getRunEvents(runId: string): Promise<TraceEvent[]> {
  return request<TraceEvent[]>(`/runs/${runId}/events`)
}

/** No auth needed. Same endpoint the orkes sink checks before sending. */
export async function getVersion(): Promise<WatcherVersion> {
  return request<WatcherVersion>('/version', { suppressAuthRedirect: true })
}

export async function listApiKeys(projectId: string): Promise<ApiKey[]> {
  return request<ApiKey[]>(`/projects/${projectId}/keys`)
}

export async function createApiKey(projectId: string, label: string, scope: ApiKey['scope']): Promise<{ key: ApiKey; secret: string }> {
  return request(`/projects/${projectId}/keys`, { method: 'POST', body: JSON.stringify({ label, scope }) })
}

export async function revokeApiKey(projectId: string, keyId: string): Promise<void> {
  await request<void>(`/projects/${projectId}/keys/${keyId}`, { method: 'DELETE' })
}

export async function listMembers(projectId: string): Promise<Member[]> {
  return request<Member[]>(`/projects/${projectId}/members`)
}

interface MemberInviteResult {
  member: Member
  activationToken: string | null
}

export async function inviteMember(projectId: string, email: string, role: Member['role']): Promise<MemberInviteResult> {
  return request<MemberInviteResult>(`/projects/${projectId}/members`, { method: 'POST', body: JSON.stringify({ email, role }) })
}

export async function resendActivation(projectId: string, userId: string): Promise<MemberInviteResult> {
  return request<MemberInviteResult>(`/projects/${projectId}/members/${userId}/resend-activation`, { method: 'POST' })
}

export async function updateMemberRole(projectId: string, userId: string, role: Member['role']): Promise<void> {
  await request<Member>(`/projects/${projectId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) })
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  await request<void>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' })
}

export async function listSessions(): Promise<Session[]> {
  return request<Session[]>('/sessions')
}

export async function revokeSession(id: string): Promise<void> {
  await request<void>(`/sessions/${id}`, { method: 'DELETE' })
}

export async function revokeOtherSessions(): Promise<void> {
  await request<void>('/sessions', { method: 'DELETE' })
}

// --- live gateway ---------------------------------------------------------
// `WS /runs/:id/live` (backend/app/routes/live.py). Server messages are
// `{type:'event', data: TraceEvent}` or `{type:'done', status}`.
//
// The socket only carries events that arrive *after* it opens; it doesn't replay earlier
// ones. So a viewer of a running run waits for `onOpen`, then fetches GET /runs/:id/events,
// and merges both by edge_run_number (agreement F4). Once the socket is open the server
// has already registered it, so nothing can slip between the two.

interface LiveHandlers {
  onEvent: (event: TraceEvent) => void
  onDone: (finalStatus: 'finished' | 'failed') => void
  onOpen?: () => void
  /** Closed without a `done` message: the run had already ended, or the connection dropped. */
  onClose?: () => void
}

export function subscribeToLiveRun(runId: string, handlers: LiveHandlers): () => void {
  const ws = new WebSocket(`${WS_BASE}/runs/${runId}/live`)
  let done = false
  let closedByUs = false

  ws.onopen = () => handlers.onOpen?.()
  ws.onmessage = (msg) => {
    const parsed = JSON.parse(msg.data)
    if (parsed.type === 'event') handlers.onEvent(parsed.data as TraceEvent)
    else if (parsed.type === 'done') {
      done = true
      handlers.onDone(parsed.status)
    }
  }
  ws.onclose = () => {
    if (!done && !closedByUs) handlers.onClose?.()
  }

  return () => {
    closedByUs = true
    ws.close()
  }
}
