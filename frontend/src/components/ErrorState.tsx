export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state">
      <h4>Something went wrong</h4>
      <p className="text-muted">{message}</p>
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          <i className="ph ph-arrow-clockwise" />
          Retry
        </button>
      )}
    </div>
  )
}
