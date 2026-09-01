import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.run import Run


async def create(db: AsyncSession, *, run_id: uuid.UUID, project_id: uuid.UUID, graph_name: str, started_at: datetime) -> Run:
    run = Run(id=run_id, project_id=project_id, graph_name=graph_name, status="running", started_at=started_at)
    db.add(run)
    await db.flush()
    return run


async def get(db: AsyncSession, run_id: uuid.UUID) -> Run | None:
    return await db.get(Run, run_id)


async def list_by_project(db: AsyncSession, project_id: uuid.UUID, *, status: str | None = None, search: str | None = None, limit: int = 200, offset: int = 0) -> list[Run]:
    stmt = select(Run).where(Run.project_id == project_id)
    if status:
        stmt = stmt.where(Run.status == status)
    if search:
        stmt = stmt.where(Run.graph_name.ilike(f"%{search}%"))
    stmt = stmt.order_by(Run.started_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def finish(
    db: AsyncSession,
    run: Run,
    *,
    status: str,
    finished_at: datetime,
    node_count: int,
    edge_count: int,
    loop_count: int,
    elapsed_us: int,
    error: str | None,
) -> Run:
    run.status = status
    run.finished_at = finished_at
    run.node_count = node_count
    run.edge_count = edge_count
    run.loop_count = loop_count
    run.elapsed_us = elapsed_us
    run.error = error
    await db.flush()
    return run


async def counts_by_status(db: AsyncSession, project_id: uuid.UUID) -> dict[str, int]:
    result = await db.execute(select(Run.status, func.count()).where(Run.project_id == project_id).group_by(Run.status))
    counts = {"running": 0, "finished": 0, "failed": 0}
    for status, count in result.all():
        counts[status] = count
    return counts


async def latest(db: AsyncSession, project_id: uuid.UUID, limit: int = 5) -> list[Run]:
    result = await db.execute(select(Run).where(Run.project_id == project_id).order_by(Run.started_at.desc()).limit(limit))
    return list(result.scalars().all())


async def elapsed_percentile(db: AsyncSession, project_id: uuid.UUID, percentile: float = 0.95) -> int | None:
    result = await db.execute(
        select(func.percentile_cont(percentile).within_group(Run.elapsed_us)).where(Run.project_id == project_id, Run.elapsed_us.is_not(None))
    )
    value = result.scalar_one_or_none()
    return int(value) if value is not None else None


async def sums(db: AsyncSession, project_id: uuid.UUID) -> tuple[int, int]:
    result = await db.execute(select(func.coalesce(func.sum(Run.edge_count), 0), func.coalesce(func.sum(Run.loop_count), 0)).where(Run.project_id == project_id))
    row = result.one()
    return int(row[0]), int(row[1])


async def hourly_counts(db: AsyncSession, project_id: uuid.UUID, since: datetime) -> list[tuple[datetime, str, int]]:
    bucket = func.date_trunc("hour", Run.started_at)
    result = await db.execute(
        select(bucket.label("bucket"), Run.status, func.count())
        .where(Run.project_id == project_id, Run.started_at >= since)
        .group_by(bucket, Run.status)
    )
    return [(row[0], row[1], row[2]) for row in result.all()]


async def delete_expired(db: AsyncSession, project_id: uuid.UUID, *, before: datetime) -> list[Run]:
    """Used by scripts/retention.py — caller deletes the MinIO blob first, then this row."""
    result = await db.execute(select(Run).where(Run.project_id == project_id, Run.started_at < before))
    return list(result.scalars().all())
