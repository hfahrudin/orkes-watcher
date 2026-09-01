import type { RunStatus } from '../lib/types'

const LABEL: Record<RunStatus, string> = { running: 'Running', finished: 'Finished', failed: 'Failed' }

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`tag tag-${status === 'finished' ? 'success' : status === 'failed' ? 'danger' : 'running'}`}>
      <span className={`status-dot ${status}`} />
      {LABEL[status]}
    </span>
  )
}
