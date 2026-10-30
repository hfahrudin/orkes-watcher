import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '../../lib/format'

export interface DurationBucket {
  start: string
  ok: number
  fail: number
  p50Us: number | null
  p95Us: number | null
}

const SERIES = [
  { key: 'p95Us', name: 'p95', color: 'var(--chart-2)' },
  { key: 'p50Us', name: 'p50', color: 'var(--chart-1)' },
] as const

const H = 180
const PAD = { top: 12, right: 40, bottom: 24, left: 52 }

/** Rounds up to 1, 2 or 5 × a power of ten, for gridline steps. */
function niceStep(max: number, steps: number): number {
  const raw = max / steps
  const pow = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
}

/**
 * p50 and p95 run time per time bucket, as two lines on one axis. Buckets with no ended
 * runs are gaps, not zero. Hover (or arrow keys) shows both values at a bucket; a table
 * view carries the same numbers without hovering.
 */
export function DurationTrend({ timeline, label, caption }: { timeline: DurationBucket[]; label: (iso: string) => string; caption: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [table])

  const hasData = timeline.some((b) => b.p95Us !== null)
  const plotW = width - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const n = timeline.length
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1))

  const { yMax, ticks } = useMemo(() => {
    const max = Math.max(1, ...timeline.map((b) => b.p95Us ?? 0))
    const step = niceStep(max, 3)
    const top = Math.ceil(max / step) * step
    return { yMax: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) }
  }, [timeline])
  const y = (us: number) => PAD.top + plotH - (us / yMax) * plotH

  // One path per series, broken at empty buckets; isolated points get a marker so they show.
  const paths = SERIES.map((s) => {
    let d = ''
    const lone: number[] = []
    timeline.forEach((b, i) => {
      const v = b[s.key]
      if (v === null) return
      const prev = i > 0 ? timeline[i - 1][s.key] : null
      const next = i < n - 1 ? timeline[i + 1][s.key] : null
      d += `${prev === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
      if (prev === null && next === null) lone.push(i)
    })
    let lastIdx = -1
    timeline.forEach((b, i) => {
      if (b[s.key] !== null) lastIdx = i
    })
    return { ...s, d, lone, lastIdx }
  })
  // Direct labels at each line's last point, nudged apart if they'd overlap.
  const labelY = paths.map((p) => (p.lastIdx >= 0 ? y(timeline[p.lastIdx][p.key] as number) : null))
  if (labelY[0] !== null && labelY[1] !== null && Math.abs(labelY[0] - labelY[1]) < 12) {
    labelY[0] = Math.min(labelY[0], labelY[1]) - 6
    labelY[1] = labelY[0] + 12
  }

  const labelEvery = Math.max(1, Math.round(n / 6))

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const i = n <= 1 ? 0 : Math.round(((e.clientX - r.left) / r.width) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1))))
  }
  const hb = hover !== null ? timeline[hover] : null

  return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h5 style={{ margin: 0 }}>Run duration</h5>
        <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>{caption}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }}>
          {SERIES.map((s) => (
            <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--c-text-dim)' }}>
              <svg width={14} height={6}><line x1={0} y1={3} x2={14} y2={3} stroke={s.color} strokeWidth={2} strokeLinecap="round" /></svg>
              {s.name}
            </span>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>
            {table ? 'Chart' : 'Table'}
          </button>
        </div>
      </div>

      {!hasData ? (
        <p className="text-muted" style={{ fontSize: 13, margin: '24px 0' }}>No finished runs in this range.</p>
      ) : table ? (
        <div className="scroll" style={{ maxHeight: H }}>
          <table className="table">
            <thead>
              <tr><th>Time</th><th style={{ textAlign: 'right' }}>p50</th><th style={{ textAlign: 'right' }}>p95</th><th style={{ textAlign: 'right' }}>Runs</th></tr>
            </thead>
            <tbody>
              {timeline.filter((b) => b.p95Us !== null).reverse().map((b) => (
                <tr key={b.start} style={{ cursor: 'default' }}>
                  <td>{new Date(b.start).toLocaleString()}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatDuration(b.p50Us)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatDuration(b.p95Us)}</td>
                  <td style={{ textAlign: 'right' }}>{b.ok + b.fail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} style={{ position: 'relative' }} tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)} aria-label="Run duration chart: use left and right arrow keys to read values">
          <svg width={width} height={H} style={{ display: 'block', overflow: 'visible' }}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-divider)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10.5} fill="var(--c-text-faint)">{formatDuration(t)}</text>
              </g>
            ))}
            {timeline.map((b, i) =>
              i === n - 1 || (n - 1 - i) % labelEvery === 0 ? (
                <text key={b.start} x={x(i)} y={H - 6} textAnchor={i === n - 1 ? 'end' : 'middle'} fontSize={10.5} fill="var(--c-text-faint)">
                  {i === n - 1 ? 'now' : label(b.start)}
                </text>
              ) : null,
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--c-text-faint)" strokeWidth={1} />}
            {paths.map((p, si) => (
              <g key={p.key}>
                <path d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {p.lone.map((i) => <circle key={i} cx={x(i)} cy={y(timeline[i][p.key] as number)} r={4} fill={p.color} stroke="var(--color-surface)" strokeWidth={2} />)}
                {labelY[si] !== null && (
                  <text x={x(p.lastIdx) + 7} y={labelY[si]!} dy="0.32em" fontSize={11} fill="var(--c-text-dim)">{p.name}</text>
                )}
                {hb && hb[p.key] !== null && <circle cx={x(hover!)} cy={y(hb[p.key] as number)} r={4} fill={p.color} stroke="var(--color-surface)" strokeWidth={2} />}
              </g>
            ))}
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
          {hb && (
            <div
              role="status"
              style={{
                // Opens on the side away from the pointer so it doesn't cover the hovered values.
                position: 'absolute', top: 4, left: x(hover!) > width / 2 ? Math.max(0, x(hover!) - 170) : Math.min(x(hover!) + 12, width - 158), width: 158, pointerEvents: 'none',
                padding: '8px 10px', borderRadius: 8, background: 'var(--color-surface)', boxShadow: 'var(--shadow-md)', fontSize: 12,
                display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              <span style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>{new Date(hb.start).toLocaleString()}</span>
              {hb.p95Us === null ? (
                <span style={{ color: 'var(--c-text-dim)' }}>No ended runs</span>
              ) : (
                SERIES.map((s) => (
                  <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width={12} height={6}><line x1={0} y1={3} x2={12} y2={3} stroke={s.color} strokeWidth={2} /></svg>
                    <strong className="mono" style={{ fontWeight: 600 }}>{formatDuration(hb[s.key])}</strong>
                    <span style={{ color: 'var(--c-text-faint)' }}>{s.name}</span>
                  </span>
                ))
              )}
              <span style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>{hb.ok + hb.fail} runs</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
