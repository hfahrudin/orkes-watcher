import uuid
from collections import defaultdict

from sqlalchemy import Float, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.run import Run, RunNodeStat
from app.repositories.run_repository import Scope


async def save_for_run(db: AsyncSession, project_id: uuid.UUID, run_id: uuid.UUID, visits: list[dict]) -> None:
    """`visits`: [{node_name, duration_us}], one entry per node visit in the run (a node
    visited 3 times in a loop appears 3 times). Stored as one row per node."""
    per_node: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for v in visits:
        per_node[v["node_name"]][0] += 1
        per_node[v["node_name"]][1] += v["duration_us"]
    db.add_all(RunNodeStat(run_id=run_id, project_id=project_id, node_name=name, visits=n, total_us=total) for name, (n, total) in per_node.items())
    await db.flush()


async def slowest(db: AsyncSession, scope: Scope, limit: int = 6) -> list[dict]:
    """Nodes with the highest mean time per visit, over the runs in `scope`."""
    visits = func.sum(RunNodeStat.visits)
    total = func.sum(RunNodeStat.total_us)
    stmt = scope.apply(
        select(RunNodeStat.node_name, func.count(RunNodeStat.run_id), visits, total).join(Run, Run.id == RunNodeStat.run_id)
    ).group_by(RunNodeStat.node_name).having(visits > 0).order_by((cast(total, Float) / visits).desc(), RunNodeStat.node_name).limit(limit)
    rows = (await db.execute(stmt)).all()
    return [{"node_name": r[0], "run_count": r[1], "visit_count": int(r[2]), "total_duration_us": int(r[3])} for r in rows]
