import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { ErrorState } from '../components/ErrorState'
import { StatusBadge } from '../components/StatusBadge'
import { formatDateTime, formatDuration } from '../lib/format'
import {
  destinations,
  edgeTypeKey,
  formatBytes,
  formatSeconds,
  isAbandoned,
  isEdge,
  isTruncated,
  mergeEvents,
  splitError,
  startOffset,
  summarizeNodes,
  type NodeSummary,
} from '../lib/trace'
import type { EdgeEvent, FunctionTrace, LLMMessage, LLMTrace, Run, TraceEvent } from '../lib/types'

// Keyed by edgeTypeKey(): orkes sends "__conditional__" etc. An unknown type falls back to
// the "forward" look rather than rendering with no stroke at all.
const STROKE: Record<string, string> = { forward: 'var(--c-muted)', conditional: 'var(--c-accent)', parallel: 'var(--c-c3)' }
const DASH: Record<string, string | undefined> = { forward: undefined, conditional: '5 3', parallel: '10 4 2 4' }
const MARKER: Record<string, string> = { forward: 'url(#ah-f)', conditional: 'url(#ah-c)', parallel: 'url(#ah-p)' }
const strokeFor = (edgeType: string | null | undefined) => STROKE[edgeTypeKey(edgeType)] ?? STROKE.forward
const dashFor = (edgeType: string | null | undefined) => {
  const key = edgeTypeKey(edgeType)
  return key in DASH ? DASH[key] : DASH.forward
}
const markerFor = (edgeType: string | null | undefined) => MARKER[edgeTypeKey(edgeType)] ?? MARKER.forward

const NODE_W = 150
const NODE_H = 36
const LEVEL_H = 90
const COL_W = 190
const MARGIN = 60

interface GNode { id: string; label: string; x: number; y: number; cap: boolean; visited: boolean }
/** One line on the canvas: a from→to pair, with every traversal that took it. */
interface GPath { key: string; from: string; to: string; edgeType: string | null; traversals: EdgeEvent[]; d: string; midX: number; midY: number }

function buildLayout(edges: EdgeEvent[], nodes: Map<string, NodeSummary>) {
  if (nodes.size === 0) return { nodes: [] as GNode[], paths: [] as GPath[], canvasW: COL_W + MARGIN * 2, canvasH: MARGIN * 2 }

  // A node's level is set the first time the run reaches it, in edge_run_number order, so
  // loops and back edges don't push nodes further down.
  const level = new Map<string, number>()
  if (nodes.has('START')) level.set('START', 0)
  for (const e of edges) {
    if (!level.has(e.from_node)) level.set(e.from_node, 0)
    for (const t of destinations(e)) if (!level.has(t)) level.set(t, (level.get(e.from_node) ?? 0) + 1)
  }
  // Nodes in the graph that this run never reached go in rows at the bottom, wrapped so
  // they're never wider than the visited part (or 3 across), keeping the run itself centred.
  const visitedCols = new Map<number, number>()
  for (const l of level.values()) visitedCols.set(l, (visitedCols.get(l) ?? 0) + 1)
  const unvisitedPerRow = Math.max(3, ...visitedCols.values())
  const firstUnvisitedLevel = level.size ? Math.max(...level.values()) + 1 : 0
  const unvisited = [...nodes.values()].filter((n) => !level.has(n.name)).map((n) => n.name)
  unvisited.forEach((name, i) => level.set(name, firstUnvisitedLevel + Math.floor(i / unvisitedPerRow)))

  const order = (name: string) => nodes.get(name)?.firstRunNumber ?? Infinity
  const byLevel = new Map<number, string[]>()
  for (const name of [...level.keys()].sort((a, b) => order(a) - order(b))) {
    const lvl = level.get(name)!
    byLevel.set(lvl, [...(byLevel.get(lvl) ?? []), name])
  }

  const maxCols = Math.max(...[...byLevel.values()].map((ids) => ids.length))
  const canvasW = Math.max(maxCols * COL_W, COL_W) + MARGIN * 2
  const pos = new Map<string, { x: number; y: number }>()
  const gnodes: GNode[] = []
  for (const [lvl, ids] of byLevel) {
    const startX = (canvasW - ids.length * COL_W) / 2 + COL_W / 2
    ids.forEach((id, i) => {
      const x = startX + i * COL_W
      const y = MARGIN + lvl * LEVEL_H
      pos.set(id, { x, y })
      gnodes.push({ id, label: id, x, y, cap: id === 'START' || id === 'END', visited: nodes.get(id)?.visited ?? false })
    })
  }
  const canvasH = MARGIN * 2 + Math.max(...byLevel.keys()) * LEVEL_H

  const pathByKey = new Map<string, GPath>()
  for (const e of edges) {
    for (const to of destinations(e)) {
      const key = `${e.from_node}->${to}`
      const existing = pathByKey.get(key)
      if (existing) existing.traversals.push(e)
      else pathByKey.set(key, { key, from: e.from_node, to, edgeType: e.edge_type, traversals: [e], d: '', midX: 0, midY: 0 })
    }
  }
  const paths = [...pathByKey.values()].map((p) => {
    const from = pos.get(p.from)!
    const to = pos.get(p.to)!
    const isBack = (level.get(p.to) ?? 0) <= (level.get(p.from) ?? 0)
    if (isBack) {
      const R = 70
      const exitX = from.x + NODE_W / 2
      const enterX = to.x + NODE_W / 2
      return { ...p, d: `M${exitX},${from.y} C${exitX + R},${from.y} ${enterX + R},${to.y} ${enterX},${to.y}`, midX: exitX + R * 0.85, midY: (from.y + to.y) / 2 }
    }
    const y1 = from.y + NODE_H / 2
    const y0 = to.y - NODE_H / 2
    const dy = (y0 - y1) * 0.45
    return { ...p, d: `M${from.x},${y1} C${from.x},${y1 + dy} ${to.x},${y0 - dy} ${to.x},${y0}`, midX: (from.x + to.x) / 2, midY: (y1 + y0) / 2 }
  })

  return { nodes: gnodes, paths, canvasW, canvasH }
}

type Selection = { kind: 'node'; name: string } | { kind: 'edge'; runNumber: number } | null

export function TraceInspectorPage() {
  const { runId } = useParams<{ projectId: string; runId: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [selected, setSelected] = useState<Selection>(null)
  const [viewMode, setViewMode] = useState<'graph' | 'timeline' | 'raw'>('graph')
  const [legendOpen, setLegendOpen] = useState(false)
  const [stateOpen, setStateOpen] = useState(true)
  const [tracebackOpen, setTracebackOpen] = useState(false)
  const [liveLost, setLiveLost] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!runId) return
    let active = true
    let unsubscribe: (() => void) | null = null
    setRun(null)
    setEvents([])
    setSelected(null)
    setError(null)
    setLiveLost(false)

    const fail = (e: unknown) => active && setError(e instanceof Error ? e.message : 'Failed to load trace')
    const refreshRun = () => api.getRun(runId).then((r) => active && r && setRun(r)).catch(fail)
    const fetchEvents = () => api.getRunEvents(runId).then((evs) => active && setEvents((prev) => mergeEvents(prev, evs))).catch(fail)

    api
      .getRun(runId)
      .then((r) => {
        if (!active) return
        if (!r) return setError('Run not found')
        setRun(r)
        if (r.status !== 'running') return void fetchEvents()
        // Socket first, fetch once it's open, merge both: see subscribeToLiveRun's note.
        unsubscribe = api.subscribeToLiveRun(runId, {
          onOpen: () => void fetchEvents(),
          onEvent: (ev) => active && setEvents((prev) => mergeEvents(prev, [ev])),
          onDone: () => void refreshRun(), // final counts, times, error and failed node
          onClose: () => {
            // Ended before we connected, or the connection dropped mid-run.
            void refreshRun()
            void fetchEvents()
            setLiveLost(true)
          },
        })
      })
      .catch(fail)

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [runId, reloadKey])

  const edges = useMemo(() => events.filter(isEdge), [events])
  const otherEvents = useMemo(() => events.filter((e) => !isEdge(e)), [events])
  const nodeSummaries = useMemo(() => summarizeNodes(edges, run?.graphNodes), [edges, run?.graphNodes])
  const layout = useMemo(() => buildLayout(edges, nodeSummaries), [edges, nodeSummaries])

  // Fit-to-width: scale small graphs up to use the available horizontal space rather than
  // leaving a gap on wide screens, but never shrink below 1:1. Width only, not height — the
  // graph flows top-to-bottom, so height is almost always the tighter constraint; vertical
  // overflow just scrolls.
  const canvasRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [run !== null, viewMode])  // the canvas only exists once the run has loaded, in graph view
  const scale = useMemo(() => {
    if (!containerWidth) return 1
    const PADDING = 40
    const fit = (containerWidth - PADDING * 2) / layout.canvasW
    return Math.min(Math.max(fit, 1), 1.4)
  }, [containerWidth, layout.canvasW])

  const selectedEdge = selected?.kind === 'edge' ? edges.find((e) => e.edge_run_number === selected.runNumber) ?? null : null
  const selectedNode = selected?.kind === 'node' ? nodeSummaries.get(selected.name) ?? null : null
  const selectEdge = (runNumber: number) => setSelected({ kind: 'edge', runNumber })
  const selectNode = (name: string) => setSelected({ kind: 'node', name })

  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  if (!run) return <p className="text-muted">Loading…</p>

  const failedNode = run.failedNode
  const abandoned = isAbandoned(run.error)
  const err = run.error ? splitError(run.error) : null

  return (
    <div className="main-flush" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 22px', boxShadow: 'inset 0 -1px 0 var(--color-divider)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}>
          <i className="ph ph-arrow-left" />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 13.5, color: 'var(--color-accent-300)' }}>{run.id}</span>
            <StatusBadge status={run.status} />
            {abandoned && <span className="tag tag-neutral" title="The orkes process stopped sending before the run ended.">Abandoned</span>}
          </div>
          <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--color-text) 52%, transparent)' }}>
            graph <span className="mono">{run.graphName}</span> · {run.nodeCount} nodes · {run.edgeCount} traversals · {run.loopCount} loops · {formatDuration(run.elapsedUs)} · started {formatDateTime(run.startedAt)}
            {run.sdkVersion && <> · orkes {run.sdkVersion}</>}
          </span>
          {run.graphDescription && <span style={{ fontSize: 11.5, color: 'var(--c-text2)' }}>{run.graphDescription}</span>}
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

      {err && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 22px', background: 'color-mix(in srgb, var(--color-danger) 9%, transparent)', boxShadow: 'inset 0 -1px 0 var(--color-divider)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
            <i className="ph ph-warning-circle" style={{ color: 'var(--color-danger)', fontSize: 15 }} />
            <span className="mono" style={{ color: 'var(--color-danger)', wordBreak: 'break-word' }}>{err.summary}</span>
            {failedNode && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => selectNode(failedNode)}>
                failed in <span className="mono">{failedNode}</span>
              </button>
            )}
            {err.detail && (
              <button className="btn btn-ghost btn-sm" style={failedNode ? undefined : { marginLeft: 'auto' }} onClick={() => setTracebackOpen((v) => !v)}>
                {tracebackOpen ? 'Hide traceback' : 'Show traceback'}
              </button>
            )}
          </div>
          {tracebackOpen && err.detail && <pre className="raw-json" style={{ margin: 0, maxHeight: 260 }}>{err.detail}</pre>}
        </div>
      )}

      {liveLost && run.status === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 22px', fontSize: 12.5, boxShadow: 'inset 0 -1px 0 var(--color-divider)' }}>
          <i className="ph ph-plugs" style={{ color: 'var(--c-muted)' }} />
          Live updates stopped.
          <button className="btn btn-ghost btn-sm" onClick={() => setReloadKey((k) => k + 1)}>Reconnect</button>
        </div>
      )}

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
              {layout.nodes.length === 0 && (
                <p className="text-muted" style={{ padding: 24, fontSize: 13 }}>
                  {run.status === 'running' ? 'Waiting for the first edge…' : 'No events were stored for this run (it may have been sampled out).'}
                </p>
              )}
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
                  {layout.paths.map((p) => {
                    const on = !!selectedEdge && p.traversals.includes(selectedEdge)
                    return (
                      <g key={p.key}>
                        <path d={p.d} fill="none" stroke={on ? 'var(--c-accent-strong)' : strokeFor(p.edgeType)} strokeWidth={on ? 2.2 : 1.3} strokeDasharray={dashFor(p.edgeType)} markerEnd={markerFor(p.edgeType)} opacity={on ? 1 : 0.72} />
                        <path className="ghit" d={p.d} onClick={() => selectEdge(p.traversals[0].edge_run_number)} />
                      </g>
                    )
                  })}
                </svg>

                {layout.paths.map((p) => {
                  const on = !!selectedEdge && p.traversals.includes(selectedEdge)
                  const label = p.traversals.length === 1 ? String(p.traversals[0].edge_run_number) : `×${p.traversals.length}`
                  return (
                    <div
                      key={p.key}
                      className="gstep"
                      title={`traversal ${p.traversals.map((t) => `#${t.edge_run_number}`).join(', ')}`}
                      onClick={() => selectEdge(on ? selectedEdge!.edge_run_number : p.traversals[0].edge_run_number)}
                      style={{ left: p.midX, top: p.midY, borderColor: on ? 'var(--c-accent-strong)' : 'var(--c-border)', color: on ? 'var(--c-accent-strong)' : 'var(--c-text2)' }}
                    >
                      {label}
                    </div>
                  )
                })}

                {layout.nodes.map((n) => {
                  const active = selectedNode?.name === n.id
                  const failed = n.id === failedNode
                  const onPath = !!selectedEdge && (selectedEdge.from_node === n.id || destinations(selectedEdge).includes(n.id))
                  const border = active ? 'var(--c-accent-strong)' : failed ? 'var(--color-danger)' : onPath ? 'var(--c-accent)' : n.cap ? 'var(--c-accent)' : 'var(--c-border)'
                  const bg = active ? 'color-mix(in srgb, var(--c-accent) 22%, var(--c-raised))' : failed ? 'color-mix(in srgb, var(--color-danger) 14%, var(--c-raised))' : n.cap ? 'color-mix(in srgb, var(--c-accent) 12%, var(--c-raised))' : 'var(--c-raised)'
                  const fg = active || n.cap ? 'var(--c-accent-strong)' : failed ? 'var(--color-danger)' : 'var(--c-text)'
                  return (
                    <div
                      key={n.id}
                      className="gnode"
                      title={n.visited ? undefined : 'Not visited in this run'}
                      onClick={() => selectNode(n.id)}
                      style={{
                        left: n.x, top: n.y, border: `1px ${n.visited ? 'solid' : 'dashed'} ${border}`, borderRadius: n.cap ? 999 : 6, background: bg, color: fg,
                        opacity: n.visited ? 1 : 0.45,
                        boxShadow: active ? '0 0 0 3px color-mix(in srgb, var(--c-accent) 22%, transparent)' : 'none',
                      }}
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
                <div style={{ width: 210, borderRadius: 10, overflow: 'hidden', background: 'var(--c-panel)', boxShadow: 'var(--shadow-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--c-raised)' }}>
                    <span style={{ fontFamily: 'var(--font-heading)', fontSize: 12.5 }}>Legend</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '11px 12px 13px', fontSize: 11.5 }}>
                    <LegendRow><span style={{ width: 26, height: 13, flex: 'none', borderRadius: 3, border: '1px solid var(--c-border)', background: 'var(--c-raised)' }} />Node</LegendRow>
                    <LegendRow><span style={{ width: 26, height: 13, flex: 'none', borderRadius: 999, border: '1px solid var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }} />Start / end</LegendRow>
                    <LegendRow><span style={{ width: 26, height: 13, flex: 'none', borderRadius: 3, border: '1px dashed var(--c-border)', opacity: 0.5 }} />Not visited</LegendRow>
                    <LegendRow><span style={{ width: 26, height: 13, flex: 'none', borderRadius: 3, border: '1px solid var(--color-danger)', background: 'color-mix(in srgb, var(--color-danger) 14%, transparent)' }} />Failed here</LegendRow>
                    <div style={{ height: 1, background: 'var(--color-divider)' }} />
                    <LegendRow><svg width={26} height={8}><line x1={0} y1={4} x2={26} y2={4} stroke="var(--c-muted)" strokeWidth={1.6} /></svg>Forward</LegendRow>
                    <LegendRow><svg width={26} height={8}><line x1={0} y1={4} x2={26} y2={4} stroke="var(--c-accent)" strokeWidth={1.6} strokeDasharray="5 3" /></svg>Conditional</LegendRow>
                    <LegendRow><svg width={26} height={8}><line x1={0} y1={4} x2={26} y2={4} stroke="var(--c-c3)" strokeWidth={1.6} strokeDasharray="10 4 2 4" /></svg>Parallel</LegendRow>
                    <div style={{ height: 1, background: 'var(--color-divider)' }} />
                    <LegendRow>
                      <span style={{ width: 26, flex: 'none', display: 'grid', placeItems: 'center' }}>
                        <span className="mono" style={{ width: 19, height: 19, borderRadius: '50%', border: '1px solid var(--c-muted)', display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--c-text2)' }}>7</span>
                      </span>
                      Step number (×N: taken N times)
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 680 }}>
              {edges.length === 0 && run.status !== 'running' && <p className="text-muted" style={{ fontSize: 13 }}>No events were stored for this run.</p>}
              {edges.map((e) => {
                const on = selectedEdge === e
                return (
                  <div
                    key={e.edge_run_number}
                    className="sideitem"
                    style={{ justifyContent: 'flex-start', color: on ? 'var(--c-accent-strong)' : undefined }}
                    onClick={() => selectEdge(e.edge_run_number)}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: strokeFor(e.edge_type), flex: 'none' }} />
                    <span className="mono" style={{ fontSize: 12.5 }}>{e.from_node} → {formatTargets(e)}</span>
                    <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{formatSeconds(e.node_elapsed ?? e.elapsed)} · #{e.edge_run_number}</span>
                  </div>
                )
              })}
              {otherEvents.map((e, i) => (
                <div key={`other-${i}`} className="sideitem" style={{ justifyContent: 'flex-start', opacity: 0.6 }} title="An event kind this watcher version doesn't use yet.">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', border: '1px solid var(--c-muted)', flex: 'none' }} />
                  <span className="mono" style={{ fontSize: 12.5 }}>{e.kind}</span>
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

          {!selectedEdge && !selectedNode && <p className="text-muted" style={{ fontSize: 13 }}>Select a node or edge to inspect it.</p>}

          {selectedNode && <NodeInspector node={selectedNode} failed={selectedNode.name === failedNode} edges={edges} onSelectEdge={selectEdge} />}
          {selectedEdge && (
            <EdgeInspector
              event={selectedEdge}
              passes={edges.filter((e) => e.edge_id === selectedEdge.edge_id)}
              runStartedAt={run.startedAt}
              stateOpen={stateOpen}
              onToggleState={() => setStateOpen((v) => !v)}
              onSelectEdge={selectEdge}
            />
          )}

          {(selectedEdge || selectedNode) && (
            <div style={{ marginTop: 'auto', display: 'flex', gap: 8, paddingTop: 6 }}>
              <button
                className="btn btn-secondary btn-block"
                style={{ margin: 0 }}
                onClick={() => {
                  const id = selectedEdge ? selectedEdge.edge_id : run.graphNodes?.find((g) => g.node_name === selectedNode!.name)?.node_id ?? selectedNode!.name
                  navigator.clipboard?.writeText(id)
                }}
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

function formatTargets(e: EdgeEvent): string {
  const targets = destinations(e)
  if (targets.length === 0) return '(no destination)'
  return Array.isArray(e.to_node) ? `[${targets.join(', ')}]` : targets[0]
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

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--c-text) 42%, transparent)' }}>{children}</span>
      {count !== undefined && <span className="tag tag-neutral" style={{ marginLeft: 'auto' }}>{count}</span>}
    </div>
  )
}

function TruncatedNote({ size }: { size: number }) {
  return (
    <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
      <i className="ph ph-scissors" /> truncated ({formatBytes(size)}): too large for orkes to send
    </p>
  )
}

function Json({ value }: { value: unknown }) {
  return <pre className="raw-json" style={{ margin: 0 }}>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
}

function NodeInspector({ node, failed, edges, onSelectEdge }: { node: NodeSummary; failed: boolean; edges: EdgeEvent[]; onSelectEdge: (runNumber: number) => void }) {
  const runs = edges.filter((e) => e.from_node === node.name)
  const avg = node.totalSeconds !== null && runs.length ? node.totalSeconds / runs.length : null
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '11px 12px', borderRadius: 8, background: 'var(--c-raised)', boxShadow: `inset 3px 0 0 ${failed ? 'var(--color-danger)' : 'var(--color-accent)'}` }}>
        <span className="mono" style={{ fontSize: 13.5 }}>{node.name}</span>
        {node.description && <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--c-text) 55%, transparent)' }}>{node.description}</span>}
        {failed && <span style={{ fontSize: 11.5, color: 'var(--color-danger)' }}>The run failed while in this node.</span>}
        {!node.visited && <span style={{ fontSize: 11.5, color: 'var(--c-muted)' }}>Part of the graph, but not visited in this run.</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '7px 10px' }}>
        {node.type && <KVRow label="type" value={node.type} color="var(--c-text2)" />}
        <KVRow label="runs" value={String(node.runs)} />
        <KVRow label="arrivals" value={String(node.arrivals)} />
        <KVRow label="total time" value={formatSeconds(node.totalSeconds)} color="var(--c-text2)" />
        <KVRow label="avg time" value={formatSeconds(avg)} color="var(--c-text2)" />
        {node.firstRunNumber !== null && <KVRow label="first step" value={`#${node.firstRunNumber}`} color="var(--c-text2)" />}
      </div>
      {runs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ height: 1, background: 'var(--color-divider)' }} />
          <SectionLabel count={runs.length}>steps from this node</SectionLabel>
          {runs.map((e) => (
            <button key={e.edge_run_number} className="sideitem" style={{ justifyContent: 'flex-start', fontSize: 12 }} onClick={() => onSelectEdge(e.edge_run_number)}>
              <span className="mono">#{e.edge_run_number} → {formatTargets(e)}</span>
              <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{formatSeconds(e.node_elapsed)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function EdgeInspector({
  event, passes, runStartedAt, stateOpen, onToggleState, onSelectEdge,
}: {
  event: EdgeEvent
  /** Every traversal of this same edge_id: more than one means a loop. */
  passes: EdgeEvent[]
  runStartedAt: string
  stateOpen: boolean
  onToggleState: () => void
  onSelectEdge: (runNumber: number) => void
}) {
  const passIndex = passes.indexOf(event)
  const offset = startOffset(event, runStartedAt)
  const fns = event.function_traces
  const llms = event.llm_traces
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '11px 12px', borderRadius: 8, background: 'var(--c-raised)', boxShadow: 'inset 3px 0 0 var(--color-accent)' }}>
        <span className="mono" style={{ fontSize: 13.5 }}>{event.from_node} → {formatTargets(event)}</span>
        <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--c-text) 55%, transparent)' }}>
          step #{event.edge_run_number} · {edgeTypeKey(event.edge_type)} edge
          {typeof event.passes_left === 'number' && ` · ${event.passes_left} passes left`}
        </span>
      </div>

      {passes.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <button className="btn btn-icon btn-secondary btn-sm" disabled={passIndex <= 0} onClick={() => onSelectEdge(passes[passIndex - 1].edge_run_number)} title="Previous pass">
            <i className="ph ph-caret-left" />
          </button>
          <span>loop pass {passIndex + 1} of {passes.length}</span>
          <button className="btn btn-icon btn-secondary btn-sm" disabled={passIndex >= passes.length - 1} onClick={() => onSelectEdge(passes[passIndex + 1].edge_run_number)} title="Next pass">
            <i className="ph ph-caret-right" />
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '7px 10px' }}>
        <KVRow label="edge_id" value={event.edge_id} color="var(--c-accent-strong)" />
        <KVRow label="edge_type" value={event.edge_type ?? '—'} color={strokeFor(event.edge_type)} />
        <KVRow label="node only" value={formatSeconds(event.node_elapsed)} />
        <KVRow label="edge total" value={formatSeconds(event.elapsed)} color="var(--c-text2)" />
        {offset !== null && <KVRow label="started" value={`+${formatSeconds(Math.max(0, offset))} into run`} color="var(--c-text2)" />}
        {typeof event.passes_left === 'number' && <KVRow label="passes_left" value={String(event.passes_left)} color="var(--c-text2)" />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 1, background: 'var(--color-divider)' }} />
        <button className="sideitem" onClick={onToggleState} style={{ padding: 0, gap: 7, color: 'var(--c-text)' }}>
          <i className={`ph ${stateOpen ? 'ph-minus-square' : 'ph-plus-square'}`} style={{ fontSize: 12, color: 'var(--color-accent)' }} />
          <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>state_snapshot</span>
          <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 10.5, textTransform: 'none' }}>before the node ran</span>
        </button>
        {stateOpen && (isTruncated(event.state_snapshot) ? <TruncatedNote size={event.state_snapshot.size} /> : <Json value={event.state_snapshot} />)}
      </div>

      {isTruncated(fns) ? (
        <TracesBlock label="function_traces"><TruncatedNote size={fns.size} /></TracesBlock>
      ) : (
        fns.length > 0 && (
          <TracesBlock label="function_traces" count={fns.length}>
            {fns.map((f, i) => <FunctionCard key={i} fn={f} />)}
          </TracesBlock>
        )
      )}

      {isTruncated(llms) ? (
        <TracesBlock label="llm_traces"><TruncatedNote size={llms.size} /></TracesBlock>
      ) : (
        llms.length > 0 && (
          <TracesBlock label="llm_traces" count={llms.length}>
            {llms.map((l, i) => <LLMCard key={i} trace={l} />)}
          </TracesBlock>
        )
      )}
    </>
  )
}

function TracesBlock({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ height: 1, background: 'var(--color-divider)' }} />
      <SectionLabel count={count}>{label}</SectionLabel>
      {children}
    </div>
  )
}

const cardStyle = { display: 'flex', flexDirection: 'column', gap: 7, padding: '10px 11px', borderRadius: 8, background: 'var(--c-raised)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' } as const
const dimLabel = { color: 'color-mix(in srgb, var(--c-text) 42%, transparent)' } as const

function FunctionCard({ fn }: { fn: FunctionTrace }) {
  const hasArgs = Array.isArray(fn.input_args) && fn.input_args.length > 0
  const hasKwargs = fn.input_kwargs && Object.keys(fn.input_kwargs).length > 0
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <i className="ph ph-function" style={{ fontSize: 13, color: 'var(--color-accent-400)' }} />
        <span className="mono" style={{ fontSize: 12.5 }}>{fn.function_name}</span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'color-mix(in srgb, var(--c-text) 50%, transparent)' }}>{formatSeconds(fn.elapsed)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: '5px 8px', fontSize: 11.5 }}>
        {hasArgs && <><span style={dimLabel}>args</span><span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{JSON.stringify(fn.input_args)}</span></>}
        {hasKwargs && <><span style={dimLabel}>kwargs</span><span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{JSON.stringify(fn.input_kwargs)}</span></>}
        <span style={dimLabel}>returns</span>
        <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{isTruncated(fn.return_value) ? `truncated (${formatBytes(fn.return_value.size)})` : JSON.stringify(fn.return_value)}</span>
      </div>
    </div>
  )
}

function llmMessages(trace: LLMTrace): LLMMessage[] | null {
  const m = trace.messages
  if (isTruncated(m)) return null
  if (Array.isArray(m)) return m
  return Array.isArray(m?.messages) ? m.messages : []
}

function LLMCard({ trace }: { trace: LLMTrace }) {
  const [open, setOpen] = useState(false)
  const messages = llmMessages(trace)
  const reply = isTruncated(trace.parsed_response) ? null : trace.parsed_response?.content
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <i className="ph ph-sparkle" style={{ fontSize: 13, color: 'var(--color-accent-400)' }} />
        <span className="mono" style={{ fontSize: 12.5 }}>{trace.model}</span>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen((v) => !v)}>{open ? 'Hide prompt' : 'Show prompt'}</button>
      </div>
      {open && (
        messages === null ? <TruncatedNote size={(trace.messages as unknown as { size: number }).size} /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 8, fontSize: 11.5 }}>
                <span style={dimLabel}>{m.role}</span>
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}</span>
              </div>
            ))}
            {trace.settings && Object.keys(trace.settings).length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 8, fontSize: 11.5 }}>
                <span style={dimLabel}>settings</span>
                <span className="mono" style={{ fontSize: 11 }}>{JSON.stringify(trace.settings)}</span>
              </div>
            )}
          </div>
        )
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 8, fontSize: 11.5 }}>
        <span style={dimLabel}>reply</span>
        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {isTruncated(trace.parsed_response) ? `truncated (${formatBytes(trace.parsed_response.size)})` : typeof reply === 'string' ? reply : JSON.stringify(reply)}
        </span>
      </div>
    </div>
  )
}
