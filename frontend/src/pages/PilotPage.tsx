import { PilotIcon } from '../components/NavIcons'

const PLANNED = [
  { icon: 'ph-pause-circle', title: 'Pause, resume, stop', text: 'Control a running agent between nodes, without killing the process.' },
  { icon: 'ph-chat-circle-dots', title: 'Answer the agent', text: 'When a node asks for input, reply here and the run carries on.' },
  { icon: 'ph-list-magnifying-glass', title: 'Then in Traces', text: 'Piloted runs land in Traces like any other run, marked as piloted.' },
]

/** Placeholder until Pilot (two-way control of a running agent) ships. */
export function PilotPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 12, color: 'var(--c-accent-strong)', background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)' }}>
          <PilotIcon className="navicon-lg" />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h4 style={{ margin: 0 }}>Pilot</h4>
            <span className="tag tag-outline">Coming soon</span>
          </div>
          <span style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>Steer a running agent from the dashboard, not just watch it.</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        {PLANNED.map((p) => (
          <div key={p.title} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 18px' }}>
            <i className={`ph ${p.icon}`} style={{ fontSize: 20, color: 'var(--c-accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</span>
            <span style={{ fontSize: 12.5, color: 'var(--c-text-dim)', lineHeight: 1.5 }}>{p.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
