import type { ReactNode } from 'react'

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h4>{title}</h4>
      <p className="text-muted">{body}</p>
      {action}
    </div>
  )
}
