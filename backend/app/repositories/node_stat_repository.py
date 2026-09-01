import uuid

from sqlalchemy import Float, cast, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.run import NodeStat


async def upsert_many(db: AsyncSession, project_id: uuid.UUID, nodes: list[dict]) -> None:
    """`nodes`: [{node_id, node_name, duration_us}], one row per node *visit* this run —
    a node visited 3 times in a loop appears 3 times, so counts add up correctly."""
    if not nodes:
        return
    for node in nodes:
        stmt = insert(NodeStat).values(
            project_id=project_id,
            node_id=node["node_id"],
            node_name=node["node_name"],
            run_count=0,  # bump_run_counts is the sole source of run_count increments
            visit_count=1,
            total_duration_us=node["duration_us"],
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[NodeStat.project_id, NodeStat.node_id],
            set_={
                "node_name": node["node_name"],
                "visit_count": NodeStat.visit_count + 1,
                "total_duration_us": NodeStat.total_duration_us + node["duration_us"],
            },
        )
        await db.execute(stmt)
    await db.flush()


async def bump_run_counts(db: AsyncSession, project_id: uuid.UUID, node_ids: set[str]) -> None:
    """Called once per finished run, after upsert_many's per-visit increments, to bump
    `run_count` (distinct runs touching this node) exactly once per node per run."""
    for node_id in node_ids:
        result = await db.execute(select(NodeStat).where(NodeStat.project_id == project_id, NodeStat.node_id == node_id))
        stat = result.scalar_one_or_none()
        if stat:
            stat.run_count += 1
    await db.flush()


async def top(db: AsyncSession, project_id: uuid.UUID, limit: int = 6) -> list[NodeStat]:
    result = await db.execute(
        select(NodeStat)
        .where(NodeStat.project_id == project_id, NodeStat.visit_count > 0)
        .order_by((cast(NodeStat.total_duration_us, Float) / NodeStat.visit_count).desc())
        .limit(limit)
    )
    return list(result.scalars().all())
