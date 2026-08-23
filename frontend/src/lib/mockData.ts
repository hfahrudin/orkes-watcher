import type {
  ApiKey,
  EdgeEvent,
  Member,
  NodeEvent,
  NodeStat,
  Project,
  Run,
  Session,
  TraceEvent,
  User,
} from './types'

// --- users -------------------------------------------------------------

export const users: User[] = [
  { id: 'u_1', email: 'fahrudinhasby12@gmail.com', name: 'Hasby Fahrudin', role: 'admin', status: 'active' },
  { id: 'u_2', email: 'dev@orkes.dev', name: 'Dana Park', role: 'developer', status: 'active' },
  { id: 'u_3', email: 'viewer@orkes.dev', name: 'Rian Sutrisno', role: 'viewer', status: 'active' },
  { id: 'u_4', email: 'invited@orkes.dev', name: 'Sam Wicaksono', role: 'developer', status: 'invited' },
]

// --- projects ------------------------------------------------------------

export const projects: Project[] = [
  { id: 'p_support', name: 'support-triage', env: 'production', retentionDays: 30, samplingPct: 100, createdAt: '2026-06-01T09:00:00Z' },
  { id: 'p_staging', name: 'support-triage', env: 'staging', retentionDays: 14, samplingPct: 50, createdAt: '2026-06-01T09:05:00Z' },
  { id: 'p_research', name: 'research-agent', env: 'local', retentionDays: 7, samplingPct: 100, createdAt: '2026-07-12T14:20:00Z' },
]

export const members: Member[] = [
  { userId: 'u_1', projectId: 'p_support', name: 'Hasby Fahrudin', email: 'fahrudinhasby12@gmail.com', role: 'admin' },
  { userId: 'u_2', projectId: 'p_support', name: 'Dana Park', email: 'dev@orkes.dev', role: 'developer' },
  { userId: 'u_3', projectId: 'p_support', name: 'Rian Sutrisno', email: 'viewer@orkes.dev', role: 'viewer' },
  { userId: 'u_4', projectId: 'p_support', name: 'Sam Wicaksono', email: 'invited@orkes.dev', role: 'developer' },
  { userId: 'u_1', projectId: 'p_staging', name: 'Hasby Fahrudin', email: 'fahrudinhasby12@gmail.com', role: 'admin' },
  { userId: 'u_1', projectId: 'p_research', name: 'Hasby Fahrudin', email: 'fahrudinhasby12@gmail.com', role: 'admin' },
]

export const apiKeys: ApiKey[] = [
  { id: 'k_1', projectId: 'p_support', label: 'prod ingest', prefix: 'ok_live_8f2a', scope: 'ingest', createdBy: 'u_1', lastUsedAt: '2026-08-22T10:12:00Z', createdAt: '2026-06-01T09:10:00Z' },
  { id: 'k_2', projectId: 'p_support', label: 'dashboard export', prefix: 'ok_live_c91d', scope: 'read', createdBy: 'u_2', lastUsedAt: null, createdAt: '2026-06-14T11:00:00Z' },
  { id: 'k_3', projectId: 'p_staging', label: 'staging ingest', prefix: 'ok_test_3b7e', scope: 'ingest', createdBy: 'u_1', lastUsedAt: '2026-08-21T18:40:00Z', createdAt: '2026-06-01T09:12:00Z' },
]

export const sessions: Session[] = [
  { id: 's_1', kind: 'browser', deviceLabel: 'Chrome on macOS', ip: '203.0.113.4', createdAt: '2026-08-22T08:00:00Z', lastSeenAt: '2026-08-22T18:20:00Z', current: true },
  { id: 's_2', kind: 'cli', deviceLabel: 'orkes-cli / Linux', ip: '203.0.113.9', createdAt: '2026-08-18T12:00:00Z', lastSeenAt: '2026-08-20T09:00:00Z', current: false },
]

// --- graph shape for the demo "support-triage" runs -----------------------

const NODE_NAMES: Record<string, string> = {
  START: 'Start',
  classify: 'Classify intent',
  retrieve: 'Retrieve context',
  tool_search: 'Search docs',
  tool_faq: 'Search FAQ',
  merge: 'Merge results',
  answer: 'Draft answer',
  escalate: 'Escalate to human',
  END: 'End',
}

function nodeEvt(nodeId: string, seq: number, visitIndex: number, enteredAt: string, exitedAt: string | null): NodeEvent {
  return { kind: 'node', nodeId, nodeName: NODE_NAMES[nodeId], seq, visitIndex, enteredAt, exitedAt }
}

function edgeEvt(
  edgeId: string,
  fromNode: string,
  toNode: string,
  edgeType: EdgeEvent['edgeType'],
  runSeq: number,
  elapsedUs: number,
  stateSnapshot: Record<string, unknown>,
  fnCalls: EdgeEvent['fnCalls'] = [],
  passesLeft: number | null = null,
): EdgeEvent {
  return { kind: 'edge', edgeId, fromNode, toNode, edgeType, runSeq, passesLeft, elapsedUs, stateSnapshot, fnCalls }
}

const t0 = Date.parse('2026-08-22T10:00:00Z')
const at = (offsetMs: number) => new Date(t0 + offsetMs).toISOString()

/** run_finished_1: happy path, includes a parallel fan-out */
export const trace_finished_1: TraceEvent[] = [
  nodeEvt('START', 0, 1, at(0), at(5)),
  edgeEvt('e_start_classify', 'START', 'classify', 'forward', 1, 5_000, { input: 'How do I reset my API key?' }),
  nodeEvt('classify', 2, 1, at(5), at(180)),
  edgeEvt('e_classify_retrieve', 'classify', 'retrieve', 'conditional', 3, 175_000, { intent: 'account_settings', needs_lookup: true }, [
    { name: 'classify_intent', args: { text: 'How do I reset my API key?' }, returns: { intent: 'account_settings', confidence: 0.97 }, durationUs: 175_000 },
  ]),
  nodeEvt('retrieve', 4, 1, at(180), at(820)),
  edgeEvt('e_retrieve_search', 'retrieve', 'tool_search', 'parallel', 5, 640_000, { intent: 'account_settings' }),
  edgeEvt('e_retrieve_faq', 'retrieve', 'tool_faq', 'parallel', 5, 640_000, { intent: 'account_settings' }),
  nodeEvt('tool_search', 6, 1, at(820), at(1400)),
  nodeEvt('tool_faq', 6, 1, at(820), at(1120)),
  edgeEvt('e_search_merge', 'tool_search', 'merge', 'forward', 7, 580_000, { docs: ['api-keys.md'] }, [
    { name: 'search_docs', args: { query: 'reset api key' }, returns: { docs: ['api-keys.md'] }, durationUs: 580_000 },
  ]),
  edgeEvt('e_faq_merge', 'tool_faq', 'merge', 'forward', 7, 300_000, { faq: ['How to rotate an API key'] }, [
    { name: 'search_faq', args: { query: 'reset api key' }, returns: { faq: ['How to rotate an API key'] }, durationUs: 300_000 },
  ]),
  nodeEvt('merge', 8, 1, at(1400), at(1480)),
  edgeEvt('e_merge_answer', 'merge', 'answer', 'conditional', 9, 80_000, { confidence: 0.94 }),
  nodeEvt('answer', 10, 1, at(1480), at(2100)),
  edgeEvt('e_answer_end', 'answer', 'END', 'forward', 11, 620_000, {
    answer: 'Go to Settings > API keys, revoke the old key, and generate a new one.',
  }, [{ name: 'draft_answer', args: {}, returns: { chars: 78 }, durationUs: 620_000 }]),
  nodeEvt('END', 12, 1, at(2100), at(2100)),
]

/** run_failed_1: hits a retry loop then escalates */
export const trace_failed_1: TraceEvent[] = [
  nodeEvt('START', 0, 1, at(0), at(4)),
  edgeEvt('e_start_classify_2', 'START', 'classify', 'forward', 1, 4_000, { input: 'my billing is wrong and also the app crashed twice' }),
  nodeEvt('classify', 2, 1, at(4), at(210)),
  edgeEvt('e_classify_retrieve_2', 'classify', 'retrieve', 'conditional', 3, 206_000, { intent: 'billing', needs_lookup: true }),
  nodeEvt('retrieve', 4, 1, at(210), at(900)),
  edgeEvt('e_retrieve_classify_loop', 'retrieve', 'classify', 'forward', 5, 690_000, { intent: 'billing', confidence: 0.31 }, [], 2),
  nodeEvt('classify', 6, 2, at(900), at(1050)),
  edgeEvt('e_classify_retrieve_2b', 'classify', 'retrieve', 'conditional', 7, 150_000, { intent: 'billing_dispute', needs_lookup: true }),
  nodeEvt('retrieve', 8, 2, at(1050), at(1700)),
  edgeEvt('e_retrieve_classify_loop_2', 'retrieve', 'classify', 'forward', 9, 650_000, { intent: 'billing_dispute', confidence: 0.28 }, [], 1),
  nodeEvt('classify', 10, 3, at(1700), at(1850)),
  edgeEvt('e_classify_escalate', 'classify', 'escalate', 'conditional', 11, 150_000, { intent: 'billing_dispute', confidence: 0.28, reason: 'low_confidence_after_retries' }),
  nodeEvt('escalate', 12, 1, at(1850), at(1900)),
  edgeEvt('e_escalate_end', 'escalate', 'END', 'forward', 13, 50_000, { escalated_to: 'human_queue' }),
  nodeEvt('END', 14, 1, at(1900), at(1900)),
]

/** run_running_1: the tail is generated live by mockApi's event emitter */
export const trace_running_1_seed: TraceEvent[] = [
  nodeEvt('START', 0, 1, at(0), at(3)),
  edgeEvt('e_start_classify_3', 'START', 'classify', 'forward', 1, 3_000, { input: 'can you summarize last week refund cases?' }),
  nodeEvt('classify', 2, 1, at(3), at(160)),
  edgeEvt('e_classify_retrieve_3', 'classify', 'retrieve', 'conditional', 3, 157_000, { intent: 'analytics', needs_lookup: true }),
  nodeEvt('retrieve', 4, 1, at(160), null),
]

export const runs: Run[] = [
  {
    id: 'run_finished_1', projectId: 'p_support', graphName: 'support-triage', status: 'finished',
    startedAt: at(0), finishedAt: at(2100), nodeCount: 9, edgeCount: 11, loopCount: 0, elapsedUs: 2_100_000, error: null,
  },
  {
    id: 'run_failed_1', projectId: 'p_support', graphName: 'support-triage', status: 'failed',
    startedAt: new Date(t0 - 3_600_000).toISOString(), finishedAt: new Date(t0 - 3_600_000 + 1_900).toISOString(),
    nodeCount: 6, edgeCount: 8, loopCount: 2, elapsedUs: 1_900_000, error: 'escalated: low_confidence_after_retries',
  },
  {
    id: 'run_running_1', projectId: 'p_support', graphName: 'support-triage', status: 'running',
    startedAt: new Date(t0 + 600_000).toISOString(), finishedAt: null, nodeCount: 3, edgeCount: 2, loopCount: 0, elapsedUs: null, error: null,
  },
  {
    id: 'run_finished_2', projectId: 'p_support', graphName: 'support-triage', status: 'finished',
    startedAt: new Date(t0 - 7_200_000).toISOString(), finishedAt: new Date(t0 - 7_200_000 + 1_800).toISOString(),
    nodeCount: 9, edgeCount: 11, loopCount: 0, elapsedUs: 1_800_000, error: null,
  },
]

export const traceEventsByRunId: Record<string, TraceEvent[]> = {
  run_finished_1: trace_finished_1,
  run_failed_1: trace_failed_1,
  run_finished_2: trace_finished_1,
  run_running_1: trace_running_1_seed,
}

function computeNodeStats(projectId: string): NodeStat[] {
  const totals = new Map<string, { nodeName: string; runIds: Set<string>; visits: number; totalUs: number }>()
  for (const run of runs) {
    if (run.projectId !== projectId) continue
    const events = traceEventsByRunId[run.id] ?? []
    for (const ev of events) {
      if (ev.kind !== 'node' || ev.exitedAt === null) continue
      const dur = Date.parse(ev.exitedAt) - Date.parse(ev.enteredAt)
      const entry = totals.get(ev.nodeId) ?? { nodeName: ev.nodeName, runIds: new Set<string>(), visits: 0, totalUs: 0 }
      entry.runIds.add(run.id)
      entry.visits += 1
      entry.totalUs += dur * 1000
      totals.set(ev.nodeId, entry)
    }
  }
  return [...totals.entries()]
    .map(([nodeId, v]) => ({ nodeId, nodeName: v.nodeName, runCount: v.runIds.size, visitCount: v.visits, totalDurationUs: v.totalUs }))
    .sort((a, b) => b.totalDurationUs / b.visitCount - a.totalDurationUs / a.visitCount)
}

export const nodeStatsByProject: Record<string, NodeStat[]> = Object.fromEntries(
  projects.map((p) => [p.id, computeNodeStats(p.id)]),
)
