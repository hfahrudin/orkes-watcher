import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.dialects.postgresql import aggregate_order_by, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.project import Project
from app.models.run import Run


async def create(
    db: AsyncSession,
    *,
    run_id: uuid.UUID,
    project_id: uuid.UUID,
    graph_name: str,
    started_at: datetime,
    contract_version: str | None = None,
    sdk_version: str | None = None,
) -> Run:
    run = Run(
        id=run_id,
        project_id=project_id,
        graph_name=graph_name,
        status="running",
        started_at=started_at,
        last_event_at=started_at,
        contract_version=contract_version,
        sdk_version=sdk_version,
    )
    db.add(run)
    await db.flush()
    return run


async def lock_or_create(
    db: AsyncSession,
    *,
    run_id: uuid.UUID,
    project_id: uuid.UUID,
    graph_name: str,
    started_at: datetime,
    contract_version: str | None,
    sdk_version: str | None,
) -> Run:
    """Returns the run, creating it if needed, row-locked until the transaction ends.

    Safe when several batches for a brand-new run arrive at once: the insert does nothing if
    another request created the row first (waiting for that request to commit), and the
    lock makes batches for one run take turns, so none can slip in while run_end is being
    finalized."""
    await db.execute(
        insert(Run)
        .values(
            id=run_id, project_id=project_id, graph_name=graph_name, status="running", started_at=started_at,
            last_event_at=started_at, contract_version=contract_version, sdk_version=sdk_version,
            node_count=0, edge_count=0, loop_count=0,
        )
        .on_conflict_do_nothing(index_elements=[Run.id])
    )
    stmt = select(Run).where(Run.id == run_id).with_for_update().execution_options(populate_existing=True)
    return (await db.execute(stmt)).scalar_one()


async def get(db: AsyncSession, run_id: uuid.UUID) -> Run | None:
    """The full row, including final_state (which list queries leave out)."""
    return await db.get(Run, run_id, options=[undefer(Run.final_state)])


def _escape_like(text: str) -> str:
    """For ILIKE with escape='\\': % and _ match themselves, not any text."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filtered(stmt, project_id: uuid.UUID, status: str | None, search: str | None, error: str | None = None, failed_node: str | None = None):
    stmt = stmt.where(Run.project_id == project_id)
    if status:
        stmt = stmt.where(Run.status == status)
    if search:
        # Case-insensitive match on graph name or run id; % and _ are literal, not wildcards.
        pattern = f"%{_escape_like(search)}%"
        stmt = stmt.where(or_(Run.graph_name.ilike(pattern, escape="\\"), cast(Run.id, String).ilike(pattern, escape="\\")))
    if error:  # dashboard "Top errors" links here with an error's first line
        stmt = stmt.where(Run.error.ilike(f"%{_escape_like(error)}%", escape="\\"))
    if failed_node:
        stmt = stmt.where(Run.failed_node == failed_node)
    return stmt


async def list_by_project(
    db: AsyncSession, project_id: uuid.UUID, *, status: str | None = None, search: str | None = None,
    error: str | None = None, failed_node: str | None = None, limit: int = 200, offset: int = 0,
) -> list[Run]:
    stmt = _filtered(select(Run), project_id, status, search, error, failed_node).order_by(Run.started_at.desc(), Run.id).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def count_by_project(
    db: AsyncSession, project_id: uuid.UUID, *, status: str | None = None, search: str | None = None,
    error: str | None = None, failed_node: str | None = None,
) -> int:
    result = await db.execute(_filtered(select(func.count()).select_from(Run), project_id, status, search, error, failed_node))
    return result.scalar_one()


async def finish(
    db: AsyncSession,
    run: Run,
    *,
    status: str,
    started_at: datetime,
    finished_at: datetime,
    node_count: int,
    edge_count: int,
    loop_count: int,
    elapsed_us: int,
    error: str | None,
    failed_node: str | None = None,
    final_state: object | None = None,
) -> Run:
    run.status = status
    run.started_at = started_at
    run.finished_at = finished_at
    run.failed_node = failed_node
    run.node_count = node_count
    run.edge_count = edge_count
    run.loop_count = loop_count
    run.elapsed_us = elapsed_us
    run.error = error
    run.final_state = final_state
    await db.flush()
    return run


@dataclass(frozen=True)
class Scope:
    """Which runs a dashboard query covers: one project, optionally from `since` onward
    and for one graph."""

    project_id: uuid.UUID
    since: datetime | None = None
    graph: str | None = None

    def apply(self, stmt):
        stmt = stmt.where(Run.project_id == self.project_id)
        if self.since is not None:
            stmt = stmt.where(Run.started_at >= self.since)
        if self.graph:
            stmt = stmt.where(Run.graph_name == self.graph)
        return stmt


async def counts_by_status(db: AsyncSession, scope: Scope) -> dict[str, int]:
    result = await db.execute(scope.apply(select(Run.status, func.count())).group_by(Run.status))
    counts = {"running": 0, "finished": 0, "failed": 0}
    for status, count in result.all():
        counts[status] = count
    return counts


async def latest(db: AsyncSession, scope: Scope, limit: int = 5) -> list[Run]:
    result = await db.execute(scope.apply(select(Run)).order_by(Run.started_at.desc(), Run.id).limit(limit))
    return list(result.scalars().all())


async def elapsed_percentile(db: AsyncSession, scope: Scope, percentile: float = 0.95) -> int | None:
    stmt = scope.apply(select(func.percentile_cont(percentile).within_group(Run.elapsed_us))).where(Run.elapsed_us.is_not(None))
    value = (await db.execute(stmt)).scalar_one_or_none()
    return int(value) if value is not None else None


async def sums(db: AsyncSession, scope: Scope) -> tuple[int, int]:
    stmt = scope.apply(select(func.coalesce(func.sum(Run.edge_count), 0), func.coalesce(func.sum(Run.loop_count), 0)))
    row = (await db.execute(stmt)).one()
    return int(row[0]), int(row[1])


async def bucket_counts(db: AsyncSession, scope: Scope, *, bucket: timedelta, origin: datetime) -> list[tuple[datetime, str, int]]:
    """Run counts per (time bucket, status). Buckets are `bucket` wide, aligned to `origin`."""
    start = func.date_bin(bucket, Run.started_at, origin)
    result = await db.execute(scope.apply(select(start.label("bucket"), Run.status, func.count())).group_by(start, Run.status))
    return [(row[0], row[1], row[2]) for row in result.all()]


async def bucket_durations(db: AsyncSession, scope: Scope, *, bucket: timedelta, origin: datetime) -> list[tuple[datetime, int, int]]:
    """(bucket start, p50 µs, p95 µs) of run time for ended runs, per time bucket."""
    start = func.date_bin(bucket, Run.started_at, origin)
    stmt = scope.apply(
        select(start, func.percentile_cont(0.5).within_group(Run.elapsed_us), func.percentile_cont(0.95).within_group(Run.elapsed_us))
    ).where(Run.status != "running", Run.elapsed_us.is_not(None)).group_by(start)
    return [(r[0], int(r[1]), int(r[2])) for r in (await db.execute(stmt)).all()]


async def top_errors(db: AsyncSession, scope: Scope, limit: int = 5) -> list[dict]:
    """Failed runs grouped by the first line of their error (orkes puts
    "<ExceptionType>: <message>" there), most frequent first."""
    message = func.split_part(Run.error, "\n", 1)
    stmt = scope.apply(
        select(message, func.count(), func.max(Run.started_at), func.array_agg(aggregate_order_by(Run.id, Run.started_at.desc()))[1])
    ).where(Run.status == "failed", Run.error.is_not(None)).group_by(message).order_by(func.count().desc(), message).limit(limit)
    return [{"message": r[0], "count": r[1], "last_seen": r[2], "sample_run_id": r[3]} for r in (await db.execute(stmt)).all()]


async def failures_by_node(db: AsyncSession, scope: Scope, limit: int = 6) -> tuple[list[dict], int]:
    """(failed runs per failed_node, most first; failed runs with no failed_node, e.g. abandoned)."""
    failed = scope.apply(select(Run.failed_node, func.count())).where(Run.status == "failed").group_by(Run.failed_node)
    rows = (await db.execute(failed)).all()
    without = sum(r[1] for r in rows if r[0] is None)
    per_node = sorted(({"node_name": r[0], "count": r[1]} for r in rows if r[0] is not None), key=lambda x: (-x["count"], x["node_name"]))
    return per_node[:limit], without


async def live_now(db: AsyncSession, project_id: uuid.UUID, graph: str | None, limit: int = 8) -> tuple[list[Run], int]:
    """Runs still in progress, most recently active first, regardless of time range."""
    scope = Scope(project_id=project_id, graph=graph)
    runs = (await db.execute(scope.apply(select(Run)).where(Run.status == "running").order_by(func.coalesce(Run.last_event_at, Run.started_at).desc()).limit(limit))).scalars().all()
    total = (await db.execute(scope.apply(select(func.count()).select_from(Run)).where(Run.status == "running"))).scalar_one()
    return list(runs), total


async def abandoned_count(db: AsyncSession, scope: Scope) -> int:
    stmt = scope.apply(select(func.count()).select_from(Run)).where(Run.status == "failed", Run.error.like("abandoned:%"))
    return (await db.execute(stmt)).scalar_one()


async def graph_names(db: AsyncSession, project_id: uuid.UUID, limit: int = 200) -> list[str]:
    result = await db.execute(select(Run.graph_name).where(Run.project_id == project_id).distinct().order_by(Run.graph_name).limit(limit))
    return list(result.scalars().all())


async def delete_expired(db: AsyncSession, project_id: uuid.UUID, *, before: datetime) -> list[Run]:
    """Used by scripts/retention.py — caller deletes the MinIO blob first, then this row."""
    result = await db.execute(select(Run).where(Run.project_id == project_id, Run.started_at < before))
    return list(result.scalars().all())


async def list_stale_running(db: AsyncSession, now: datetime) -> list[tuple[Run, Project]]:
    """Running runs with no batch for longer than their project's abandon_after_minutes."""
    last_seen = func.coalesce(Run.last_event_at, Run.started_at)
    cutoff = now - func.make_interval(0, 0, 0, 0, 0, Project.abandon_after_minutes)
    result = await db.execute(
        select(Run, Project)
        .join(Project, Project.id == Run.project_id)
        .where(Run.status == "running", last_seen < cutoff)
        # A run that's locked is mid-batch right now, so it isn't abandoned: skip it.
        .with_for_update(of=Run, skip_locked=True)
    )
    return [(row[0], row[1]) for row in result.all()]
