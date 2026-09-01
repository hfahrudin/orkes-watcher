import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { formatDateTime, formatDuration } from '../lib/format'
import type { EdgeEvent, NodeEvent, Run, TraceEvent } from '../lib/types'

// edgeType isn't a closed set (see types.ts) — an unrecognized value falls back to the
// "forward" look rather than rendering with no stroke at all.
const STROKE: Record<string, string> = { forward: 'var(--c-muted)', conditional: 'var(--c-accent)', parallel: 'var(--c-c3)' }
const DASH: Record<string, string | undefined> = { forward: undefined, conditional: '5 3', parallel: '10 4 2 4' }
const MARKER: Record<string, string> = { forward: 'url(#ah-f)', conditional: 'url(#ah-c)', parallel: 'url(#ah-p)' }
const strokeFor = (edgeType: string) => STROKE[edgeType] ?? STROKE.forward
const dashFor = (edgeType: string) => (edgeType in DASH ? DASH[edgeType] : DASH.forward)
const markerFor = (edgeType: string) => MARKER[edgeType] ?? MARKER.forward

const NODE_W = 150
const NODE_H = 36
const LEVEL_H = 90
const COL_W = 190
const MARGIN = 60

interface GNode { id: string; label: string; x: number; y: number; cap: boolean }
interface GEdge extends EdgeEvent { d: string; midX: number; midY: number; isBack: boolean }

function buildLayout(events: TraceEvent[]) {
  const nodeMeta = new Map<string, { nodeName: string; firstSeq: number; visits: number }>()
  const edgeList: EdgeEvent[] = []
  const seenEdgeIds = new Set<string>()

  for (const ev of events) {
    if (ev.kind === 'node') {
      const m = nodeMeta.get(ev.nodeId)
      if (m) m.visits += 1
      else nodeMeta.set(ev.nodeId, { nodeName: ev.nodeName, firstSeq: ev.seq, visits: 1 })
    } else if (!seenEdgeIds.has(ev.edgeId)) {
      seenEdgeIds.add(ev.edgeId)
      edgeList.push(ev)
    }
  }

  // An edge can arrive (live) referencing a node that hasn't had its own node-event yet —
  // seed a placeholder so layout/position lookups below never come up empty.
  for (const e of edgeList) {
    for (const id of [e.fromNode, e.toNode]) {
      if (!nodeMeta.has(id)) nodeMeta.set(id, { nodeName: id, firstSeq: e.runSeq, visits: 0 })
    }
  }

  if (nodeMeta.size === 0) {
    return { nodes: [] as GNode[], edges: [] as GEdge[], canvasW: COL_W + MARGIN * 2, canvasH: MARGIN * 2, nodeMeta }
  }

  const level = new Map<string, number>()
  for (const id of nodeMeta.keys()) level.set(id, 0)
  for (const e of [...edgeList].sort((a, b) => a.runSeq - b.runSeq)) {
    const srcLevel = level.get(e.fromNode) ?? 0
    if (srcLevel + 1 > (level.get(e.toNode) ?? 0)) level.set(e.toNode, srcLevel + 1)
  }

  const byLevel = new Map<number, string[]>()
  for (const [id] of [...nodeMeta.entries()].sort((a, b) => a[1].firstSeq - b[1].firstSeq)) {
    const lvl = level.get(id) ?? 0
    byLevel.set(lvl, [...(byLevel.get(lvl) ?? []), id])
  }

  const maxCols = Math.max(...[...byLevel.values()].map((ids) => ids.length))
  const canvasW = Math.max(maxCols * COL_W, COL_W) + MARGIN * 2
  const pos = new Map<string, { x: number; y: number }>()
  const nodes: GNode[] = []
  for (const [lvl, ids] of byLevel) {
    const rowW = ids.length * COL_W
    const startX = (canvasW - rowW) / 2 + COL_W / 2
    ids.forEach((id, i) => {
      const x = startX + i * COL_W
      const y = MARGIN + lvl * LEVEL_H
      pos.set(id, { x, y })
      const meta = nodeMeta.get(id)!
      nodes.push({ id, label: meta.nodeName, x, y, cap: id === 'START' || id === 'END' })
    })
  }
  const canvasH = MARGIN * 2 + Math.max(...byLevel.keys()) * LEVEL_H

  const edges: GEdge[] = edgeList.map((e) => {
    const from = pos.get(e.fromNode)!
    const to = pos.get(e.toNode)!
    const isBack = (level.get(e.toNode) ?? 0) <= (level.get(e.fromNode) ?? 0)
    let d: string, midX: number, midY: number
    if (isBack) {
      const R = 70
      const exitX = from.x + NODE_W / 2
      const enterX = to.x + NODE_W / 2
      d = `M${exitX},${from.y} C${exitX + R},${from.y} ${enterX + R},${to.y} ${enterX},${to.y}`
      midX = exitX + R * 0.85
      midY = (from.y + to.y) / 2
    } else {
      const y1 = from.y + NODE_H / 2
      const y0 = to.y - NODE_H / 2
      const dy = (y0 - y1) * 0.45
      d = `M${from.x},${y1} C${from.x},${y1 + dy} ${to.x},${y0 - dy} ${to.x},${y0}`
      midX = (from.x + to.x) / 2
      midY = (y1 + y0) / 2
    }
    return { ...e, d, midX, midY, isBack }
  })

  return { nodes, edges, canvasW, canvasH, nodeMeta }
}

type Selection = { kind: 'node'; event: NodeEvent } | { kind: 'edge'; event: EdgeEvent } | null

export function TraceInspectorPage() {
  const { runId } = useParams<{ projectId: string; runId: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [selected, setSelected] = useState<Selection>(null)
  const [viewMode, setViewMode] = useState<'graph' | 'timeline' | 'raw'>('graph')
  const [legendOpen, setLegendOpen] = useState(false)
  const [stateOpen, setStateOpen] = useState(true)

  useEffect(() => {
    if (!runId) return
    setRun(null)
    setEvents([])
    setSelected(null)
    api.getRun(runId).then((r) => setRun(r ?? null))
    api.getRunEvents(runId).then(setEvents)
  }, [runId])

  useEffect(() => {
    if (!runId || run?.status !== 'running') return
    return api.subscribeToLiveRun(
      runId,
      (event) => setEvents((prev) => [...prev, event]),
      (finalStatus) => setRun((r) => (r ? { ...r, status: finalStatus, finishedAt: new Date().toISOString() } : r)),
    )
  }, [runId, run?.status])

  const layout = useMemo(() => buildLayout(events), [events])

  // Fit-to-width: scale small graphs up to use the available horizontal space rather than
  // leaving a gap on wide screens, but never shrink below 1:1. Width only, not height — the
  // graph flows top-to-bottom, so height is almost always the tighter constraint (browser
  // window height vs. a multi-level graph's vertical span); tying scale to height too would
  // cap it back down to 1 in most real windows and cancel the effect out. Vertical overflow
  // still just scrolls, same as before.
  const canvasRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = useMemo(() => {
    if (!containerWidth) return 1
    const PADDING = 40
    const fit = (containerWidth - PADDING * 2) / layout.canvasW
    return Math.min(Math.max(fit, 1), 1.4)
  }, [containerWidth, layout.canvasW])

  const selectedEdgeId = selected?.kind === 'edge' ? selected.event.edgeId : null
  const selectedNodeId = selected?.kind === 'node' ? selected.event.nodeId : null

  function selectNode(nodeId: string) {
    const ev = [...events].reverse().find((e): e is NodeEvent => e.kind === 'node' && e.nodeId === nodeId)
    if (ev) setSelected({ kind: 'node', event: ev })
  }
  function selectEdge(edgeId: string) {
    const ev = events.find((e): e is EdgeEvent => e.kind === 'edge' && e.edgeId === edgeId)
    if (ev) setSelected({ kind: 'edge', event: ev })
  }

  if (!run) return <p className="text-muted">Loading…</p>

  return (
    <div className="main-flush" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 22px', boxShadow: 'inset 0 -1px 0 var(--color-divider)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}>
          <i className="ph ph-arrow-left" />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 13.5, color: 'var(--color-accent-300)' }}>{run.id}</span>
            <span className="tag tag-accent">{run.status.toUpperCase()}</span>
          </div>
          <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--color-text) 52%, transparent)' }}>
            graph <span className="mono">{run.graphName}</span> · {run.nodeCount} nodes · {run.edgeCount} traversals · {formatDuration(run.elapsedUs)} · started {formatDateTime(run.startedAt)}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="seg">
            <label className="seg-opt"><input type="radio" name="gv" checked={viewMode === 'graph'} onChange={() => setViewMode('graph')} /><i className="ph ph-graph" />Graph</label>
            <label className="seg-opt"><input type="radio" name="gv" checked={viewMode === 'timeline'} onChange={() => setViewMode('timeline')} /><i className="ph ph-rows" />Timeline</label>
            <label className="seg-opt"><input type="radio" name="gv" checked={viewMode === 'raw'} onChange={() => setViewMode('raw')} /><i className="ph ph-brackets-curly" />Raw</label>
          </div>
          <button className="btn btn-secondary" disabled title="Replay isn't implemented yet.">
            <i className="ph ph-arrow-counter-clockwise" />
            Replay
          </button>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {viewMode === 'graph' && (
          <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
            <div
              ref={canvasRef}
              className="scroll"
              style={{
                flex: 1, minWidth: 0, overflow: 'auto',
                background:
                  'radial-gradient(circle at center, color-mix(in srgb, var(--c-text) 7%, transparent) 1px, transparent 1px) 0 0 / 26px 26px, var(--c-canvas)',
              }}
            >
              {/* outer div reserves the scaled footprint so `margin: auto` centers correctly;
                  inner div stays at natural coordinates and is visually scaled to fill it */}
              <div style={{ position: 'relative', width: layout.canvasW * scale, height: layout.canvasH * scale, margin: '22px auto 36px' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: layout.canvasW, height: layout.canvasH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <svg viewBox={`0 0 ${layout.canvasW} ${layout.canvasH}`} style={{ position: 'absolute', inset: 0, width: layout.canvasW, height: layout.canvasH, overflow: 'visible' }}>
                  <defs>
                    <marker id="ah-f" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--c-muted)" /></marker>
                    <marker id="ah-c" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--c-accent)" /></marker>
                    <marker id="ah-p" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--c-c3)" /></marker>
                  </defs>
                  {layout.edges.map((e) => {
                    const on = e.edgeId === selectedEdgeId
                    return (
                      <g key={e.edgeId}>
                        <path d={e.d} fill="none" stroke={on ? 'var(--c-accent-strong)' : strokeFor(e.edgeType)} strokeWidth={on ? 2.2 : 1.3} strokeDasharray={dashFor(e.edgeType)} markerEnd={markerFor(e.edgeType)} opacity={on ? 1 : 0.72} />
                        <path className="ghit" d={e.d} onClick={() => selectEdge(e.edgeId)} />
                      </g>
                    )
                  })}
                </svg>

                {layout.edges.map((e) => (
                  <div
                    key={e.edgeId}
                    className="gstep"
                    onClick={() => selectEdge(e.edgeId)}
                    style={{ left: e.midX, top: e.midY, borderColor: e.edgeId === selectedEdgeId ? 'var(--c-accent-strong)' : 'var(--c-border)', color: e.edgeId === selectedEdgeId ? 'var(--c-accent-strong)' : 'var(--c-text2)' }}
                  >
                    {e.runSeq}
                  </div>
                ))}

                {layout.nodes.map((n) => {
                  const active = n.id === selectedNodeId
                  const onPath = selected?.kind === 'edge' && (selected.event.fromNode === n.id || selected.event.toNode === n.id)
                  const border = active ? 'var(--c-accent-strong)' : onPath ? 'var(--c-accent)' : n.cap ? 'var(--c-accent)' : 'var(--c-border)'
                  const bg = active ? 'color-mix(in srgb, var(--c-accent) 22%, var(--c-raised))' : n.cap ? 'color-mix(in srgb, var(--c-accent) 12%, var(--c-raised))' : 'var(--c-raised)'
                  const fg = active || n.cap ? 'var(--c-accent-strong)' : 'var(--c-text)'
                  return (
                    <div
                      key={n.id}
                      className="gnode"
                      onClick={() => selectNode(n.id)}
                      style={{ left: n.x, top: n.y, border: `1px solid ${border}`, borderRadius: n.cap ? 999 : 6, background: bg, color: fg, boxShadow: active ? '0 0 0 3px color-mix(in srgb, var(--c-accent) 22%, transparent)' : 'none' }}
                    >
                      {n.label}
                    </div>
                  )
                })}
              </div>
              </div>
            </div>

            <div style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              {legendOpen && (
                <div style={{ width: 200, borderRadius: 10, overflow: 'hidden', background: 'var(--c-panel)', boxShadow: 'var(--shadow-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--c-raised)' }}>
                    <span style={{ fontFamily: 'var(--font-heading)', fontSize: 12.5 }}>Legend</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '11px 12px 13px', fontSize: 11.5 }}>
                    <LegendRow><span style={{ width: 26, height: 13, flex: 'none', borderRadius: 3, border: '1px solid var(--c-border)', background: 'var(--c-raised)' }} />Node</LegendRow>
                    <LegendRow><span style={{ width: 26, height: 13, flex: 'none', borderRadius: 999, border: '1px solid var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }} />Start / end</LegendRow>
                    <div style={{ height: 1, background: 'var(--color-divider)' }} />
                    <LegendRow><svg width={26} height={8}><line x1={0} y1={4} x2={26} y2={4} stroke="var(--c-muted)" strokeWidth={1.6} /></svg>Forward</LegendRow>
                    <LegendRow><svg width={26} height={8}><line x1={0} y1={4} x2={26} y2={4} stroke="var(--c-accent)" strokeWidth={1.6} strokeDasharray="5 3" /></svg>Conditional</LegendRow>
                    <LegendRow><svg width={26} height={8}><line x1={0} y1={4} x2={26} y2={4} stroke="var(--c-c3)" strokeWidth={1.6} strokeDasharray="10 4 2 4" /></svg>Parallel</LegendRow>
                    <div style={{ height: 1, background: 'var(--color-divider)' }} />
                    <LegendRow>
                      <span style={{ width: 26, flex: 'none', display: 'grid', placeItems: 'center' }}>
                        <span className="mono" style={{ width: 19, height: 19, borderRadius: '50%', border: '1px solid var(--c-muted)', display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--c-text2)' }}>7</span>
                      </span>
                      Step number
                    </LegendRow>
                  </div>
                </div>
              )}
              <button className="themebtn" onClick={() => setLegendOpen((v) => !v)} style={{ background: 'var(--c-panel)', boxShadow: 'var(--shadow-sm)' }}>
                <i className={`ph ${legendOpen ? 'ph-x' : 'ph-info'}`} style={{ fontSize: 13 }} />
                Legend
              </button>
            </div>
          </div>
        )}

        {viewMode === 'timeline' && (
          <div className="scroll" style={{ flex: 1, minWidth: 0, padding: '18px 26px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 640 }}>
              {events.map((ev, i) => (
                <div
                  key={i}
                  className="sideitem"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => (ev.kind === 'node' ? selectNode(ev.nodeId) : selectEdge(ev.edgeId))}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: ev.kind === 'node' ? 'var(--c-accent)' : 'var(--color-neutral-500)', flex: 'none' }} />
                  {ev.kind === 'node' ? (
                    <span>{ev.nodeName} <span className="text-muted">#{ev.visitIndex}</span></span>
                  ) : (
                    <span className="mono" style={{ fontSize: 12.5 }}>{ev.fromNode} → {ev.toNode}</span>
                  )}
                  <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>seq {ev.kind === 'node' ? ev.seq : ev.runSeq}</span>
                </div>
              ))}
              {run.status === 'running' && <div className="text-muted" style={{ padding: '6px 9px', fontSize: 13 }}>● waiting for next event…</div>}
            </div>
          </div>
        )}

        {viewMode === 'raw' && (
          <div className="scroll" style={{ flex: 1, minWidth: 0, padding: '18px 26px' }}>
            <pre className="raw-json" style={{ maxHeight: 'none' }}>{JSON.stringify(events, null, 2)}</pre>
          </div>
        )}

        <aside className="scroll" style={{ width: 372, flex: 'none', display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', background: 'var(--c-panel)', boxShadow: 'inset 1px 0 0 var(--color-divider)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ph ph-list" style={{ color: 'var(--color-neutral-500)' }} />
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>Inspector</span>
            {selected && <span className={selected.kind === 'node' ? 'tag tag-accent' : 'tag tag-outline'} style={{ marginLeft: 'auto' }}>{selected.kind}</span>}
          </div>

          {!selected && <p className="text-muted" style={{ fontSize: 13 }}>Select a node or edge to inspect it.</p>}

          {selected?.kind === 'node' && (
            <NodeInspector event={selected.event} events={events} nodeMeta={layout.nodeMeta} />
          )}
          {selected?.kind === 'edge' && (
            <EdgeInspector event={selected.event} stateOpen={stateOpen} onToggleState={() => setStateOpen((v) => !v)} />
          )}

          {selected && (
            <div style={{ marginTop: 'auto', display: 'flex', gap: 8, paddingTop: 6 }}>
              <button
                className="btn btn-secondary btn-block"
                style={{ margin: 0 }}
                onClick={() => navigator.clipboard?.writeText(selected.kind === 'node' ? selected.event.nodeId : selected.event.edgeId)}
              >
                <i className="ph ph-copy" />
                Copy ID
              </button>
              <button className="btn btn-primary btn-block" style={{ margin: 0 }} onClick={() => setViewMode('graph')}>
                <i className="ph ph-crosshair" />
                Focus
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function LegendRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
}

function KVRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'contents' }}>
      <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--c-text) 42%, transparent)', paddingTop: 2 }}>{label}</span>
      <span className="mono" style={{ fontSize: 12, wordBreak: 'break-all', color: color ?? 'var(--c-text)' }}>{value}</span>
    </div>
  )
}

function NodeInspector({ event, events, nodeMeta }: { event: NodeEvent; events: TraceEvent[]; nodeMeta: Map<string, { visits: number; firstSeq: number }> }) {
  const touching = events.filter((e): e is EdgeEvent => e.kind === 'edge' && (e.fromNode === event.nodeId || e.toNode === event.nodeId))
  const meta = nodeMeta.get(event.nodeId)
  const shape = event.nodeId === 'START' || event.nodeId === 'END' ? 'ellipse' : 'box'
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '11px 12px', borderRadius: 8, background: 'var(--c-raised)', boxShadow: 'inset 3px 0 0 var(--color-accent)' }}>
        <span className="mono" style={{ fontSize: 13.5 }}>{event.nodeId}</span>
        <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--c-text) 55%, transparent)' }}>{event.nodeName}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '7px 10px' }}>
        <KVRow label="node_name" value={event.nodeName} />
        <KVRow label="shape" value={shape} color="var(--c-text2)" />
        <KVRow label="traversals" value={String(touching.length)} />
        <KVRow label="visits" value={String(meta?.visits ?? event.visitIndex)} />
        <KVRow label="first seq" value={String(meta?.firstSeq ?? event.seq)} color="var(--c-text2)" />
      </div>
    </>
  )
}

function EdgeInspector({ event, stateOpen, onToggleState }: { event: EdgeEvent; stateOpen: boolean; onToggleState: () => void }) {
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '11px 12px', borderRadius: 8, background: 'var(--c-raised)', boxShadow: 'inset 3px 0 0 var(--color-accent)' }}>
        <span className="mono" style={{ fontSize: 13.5 }}>{event.fromNode} → {event.toNode}</span>
        <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--c-text) 55%, transparent)' }}>
          traversal #{event.runSeq} · {event.edgeType} edge{event.passesLeft !== null ? ` · ${event.passesLeft} passes left` : ''}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '7px 10px' }}>
        <KVRow label="edge_id" value={event.edgeId} color="var(--c-accent-strong)" />
        <KVRow label="edge_type" value={event.edgeType} color={strokeFor(event.edgeType)} />
        <KVRow label="run seq" value={String(event.runSeq)} />
        {event.passesLeft !== null && <KVRow label="passes_left" value={String(event.passesLeft)} />}
        <KVRow label="elapsed" value={formatDuration(event.elapsedUs)} color="var(--c-text2)" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 1, background: 'var(--color-divider)' }} />
        <button className="sideitem" onClick={onToggleState} style={{ padding: 0, gap: 7, color: 'var(--c-text)' }}>
          <i className={`ph ${stateOpen ? 'ph-minus-square' : 'ph-plus-square'}`} style={{ fontSize: 12, color: 'var(--color-accent)' }} />
          <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>state_snapshot</span>
        </button>
        {stateOpen && <pre className="raw-json" style={{ margin: 0 }}>{JSON.stringify(event.stateSnapshot, null, 2)}</pre>}
      </div>

      {event.fnCalls.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ height: 1, background: 'var(--color-divider)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--c-text) 42%, transparent)' }}>function_traces</span>
            <span className="tag tag-neutral" style={{ marginLeft: 'auto' }}>{event.fnCalls.length}</span>
          </div>
          {event.fnCalls.map((f, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '10px 11px', borderRadius: 8, background: 'var(--c-raised)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <i className="ph ph-function" style={{ fontSize: 13, color: 'var(--color-accent-400)' }} />
                <span className="mono" style={{ fontSize: 12.5 }}>{f.name}</span>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'color-mix(in srgb, var(--c-text) 50%, transparent)' }}>{formatDuration(f.durationUs)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: '5px 8px', fontSize: 11.5 }}>
                <span style={{ color: 'color-mix(in srgb, var(--c-text) 42%, transparent)' }}>args</span>
                <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{JSON.stringify(f.args)}</span>
                {f.returns && (
                  <>
                    <span style={{ color: 'color-mix(in srgb, var(--c-text) 42%, transparent)' }}>returns</span>
                    <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{JSON.stringify(f.returns)}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
