/** Matches the mark in working_context/design-src exactly: an orbiting sweep with
 * an arrowhead, plus a center dot — a "watcher" motif, not a generic gradient square. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} style={{ flex: 'none', display: 'block' }}>
      <defs>
        <marker id="orkes-logo-tip" viewBox="0 0 8 8" refX="5.4" refY="4" markerWidth="4.4" markerHeight="4.4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-accent)" />
        </marker>
      </defs>
      <path
        d="M22.02 24.6A10.5 10.5 0 1 1 26.34 14.18"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2.9}
        strokeLinecap="round"
        markerEnd="url(#orkes-logo-tip)"
      />
      <circle cx={22.02} cy={24.6} r={2.9} fill="var(--color-teal)" />
      <circle cx={16} cy={16} r={3.3} fill="var(--color-teal)" />
    </svg>
  )
}

export function BrandLockup({ size = 28 }: { size?: number }) {
  return (
    <>
      <Logo size={size} />
      <div className="brand-lockup">
        <span className="brand-name">Orkes</span>
        <span className="brand-sub">watcher</span>
      </div>
    </>
  )
}
