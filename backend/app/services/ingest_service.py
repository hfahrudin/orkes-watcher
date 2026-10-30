import json
import random
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.models.project import ApiKey, Project
from app.models.run import Run
from app.repositories import node_stat_repository, project_repository, run_repository, trace_blob_repository
from app.schemas.trace_event import IngestBatch, RunEndEvent
from app.services.live_service import live_registry
from app.services.run_stats import compute_run_stats, order_events

ABANDONED_ERROR = "abandoned: no run_end received"
_STATUS_FROM_ORKES = {"FINISHED": "finished", "FAILED": "failed"}


async def process_batch(db: AsyncSession, key: ApiKey, batch: IngestBatch) -> None:
    run_id_str = str(batch.run_id)
    now = datetime.now(timezone.utc)

    run = await run_repository.lock_or_create(
        db,
        run_id=batch.run_id,
        project_id=key.project_id,
        graph_name=batch.graph_name,
        started_at=now,  # replaced by orkes's own start_time when run_end arrives
        contract_version=batch.contract_version,
        sdk_version=batch.sdk.version,
    )
    if run.project_id != key.project_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Run {batch.run_id} belongs to a different project")
    elif run.status != "running":
        # Exactly one run_end per run, nothing after it (contract §2.2). Without this, a
        # late batch would re-run _finalize against an empty buffer and overwrite stats.
        raise HTTPException(status.HTTP_409_CONFLICT, f"Run {batch.run_id} is already {run.status} — cannot ingest further events")

    # Any batch can be lost, including the first, so keep the first node list / description
    # that shows up rather than only reading them from the run-creating batch.
    if run.graph_nodes is None and batch.nodes is not None:
        run.graph_nodes = [n.model_dump(mode="json") for n in batch.nodes]
    if run.graph_description is None and batch.graph_description is not None:
        run.graph_description = batch.graph_description
    run.last_event_at = now

    project = await project_repository.get(db, key.project_id)
    assert project is not None  # the API key's project_id is a live FK, this can't be missing

    finalized = False
    for event in batch.events:
        if isinstance(event, RunEndEvent):
            await _finalize(db, project, run, event)
            finalized = True
        else:
            await live_registry.publish(run_id_str, event.model_dump(mode="json"))

    if not finalized:
        _update_running_counts(run, live_registry.buffer(run_id_str))

    await db.commit()
    if finalized:
        # Only after the commit: viewers re-fetch the run as soon as they see `done`.
        await end_live_stream(run)


def _update_running_counts(run: Run, buffer: list[dict]) -> None:
    """Keeps the list view's counts current while the run streams; run_end recomputes them.
    max() so a backend restart (which empties the in-memory buffer) can't shrink them."""
    stats = compute_run_stats(buffer)
    run.node_count = max(run.node_count, stats.node_count)
    run.edge_count = max(run.edge_count, stats.edge_count)
    run.loop_count = max(run.loop_count, stats.loop_count)


async def _finalize(db: AsyncSession, project: Project, run: Run, event: RunEndEvent) -> None:
    if event.start_time is not None and event.elapsed_time is not None:
        # orkes's clock, not ours: excludes network and batching delay (contract §2.2).
        started_at = datetime.fromtimestamp(event.start_time, timezone.utc)
        finished_at = started_at + timedelta(seconds=event.elapsed_time)
    else:
        started_at = run.started_at
        finished_at = datetime.now(timezone.utc)

    await close_run(
        db,
        project,
        run,
        status=_STATUS_FROM_ORKES[event.status],
        started_at=started_at,
        finished_at=finished_at,
        error=event.error,
        failed_node=event.failed_node,
        final_state=event.final_state,
    )


async def abandon_run(db: AsyncSession, project: Project, run: Run) -> None:
    """Marks a run that never sent run_end as failed (contract §2.2)."""
    last_seen = run.last_event_at or run.started_at
    await close_run(db, project, run, status="failed", started_at=run.started_at, finished_at=last_seen, error=ABANDONED_ERROR, failed_node=None)


async def close_run(
    db: AsyncSession,
    project: Project,
    run: Run,
    *,
    status: str,
    started_at: datetime,
    finished_at: datetime,
    error: str | None,
    failed_node: str | None,
    final_state: object | None = None,
) -> None:
    """Computes the run's stats from its buffered events, stores them and flushes the trace
    blob. Shared by a normal run_end and the abandoned-run sweep. The caller commits, then
    calls end_live_stream() — never before the commit (see end_live_stream)."""
    run_id_str = str(run.id)
    buffer = order_events(live_registry.buffer(run_id_str))
    stats = compute_run_stats(buffer)

    await run_repository.finish(
        db,
        run,
        status=status,
        started_at=started_at,
        finished_at=finished_at,
        node_count=stats.node_count,
        edge_count=stats.edge_count,
        loop_count=stats.loop_count,
        elapsed_us=max(0, int((finished_at - started_at).total_seconds() * 1_000_000)),
        error=error,
        failed_node=failed_node,
        final_state=final_state,
    )

    await node_stat_repository.save_for_run(db, project.id, run.id, stats.node_durations)

    # Sampling applies at finalize, not ingest start — the outcome isn't known until now,
    # and failures are never sampled away. See DATABASE.md.
    should_flush = status == "failed" or random.randint(1, 100) <= project.sampling_pct
    if should_flush and buffer:
        ndjson = "\n".join(json.dumps(e) for e in buffer).encode()
        await run_in_threadpool(trace_blob_repository.put_trace, project.id, run.id, ndjson)


async def end_live_stream(run: Run) -> None:
    """Sends viewers `done` and drops the run's in-memory buffer. Must run after the
    run's final state is committed: viewers re-fetch the run and its events on `done`, and
    before the commit they'd still see it `running`, with its buffer already gone."""
    run_id_str = str(run.id)
    await live_registry.publish_done(run_id_str, run.status)
    live_registry.discard(run_id_str)

