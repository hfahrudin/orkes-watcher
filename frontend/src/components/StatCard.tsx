export function StatCard({ kicker, value, sub }: { kicker: string; value: string; sub?: string }) {
  return (
    <div className="card stat-card">
      <div className="card-kicker">{kicker}</div>
      <div className="stat-row">
        <div className="stat-value">{value}</div>
      </div>
      {sub && <div className="card-meta">{sub}</div>}
    </div>
  )
}
