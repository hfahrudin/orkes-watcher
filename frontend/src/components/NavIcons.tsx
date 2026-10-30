// Custom sidebar icons, drawn to sit alongside the Phosphor (regular weight) icons: 24-unit
// grid, rounded 1.6 strokes, currentColor. Sized by the .navicon class.

type IconProps = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** Traces: a run's path through graph nodes, branching. */
export function TracesIcon({ className = '' }: IconProps) {
  return (
    <svg {...base} className={`navicon ${className}`}>
      <circle cx="5" cy="5" r="2.2" />
      <circle cx="5" cy="19" r="2.2" />
      <circle cx="19" cy="12" r="2.2" />
      <path d="M5 7.2v9.6M6.6 6.5c4 1.2 7.6 2.8 10.4 4.4M6.6 17.5c4-1.2 7.6-2.8 10.4-4.4" />
    </svg>
  )
}

/** Pilot: a command console, for sending commands to a running agent. */
export function PilotIcon({ className = '' }: IconProps) {
  return (
    <svg {...base} className={`navicon ${className}`}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 8.5h18M7 12.5l2.5 2-2.5 2M12 16.5h4.5" />
    </svg>
  )
}
