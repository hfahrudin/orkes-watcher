import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.models.run import Run
from app.repositories import node_stat_repository, run_repository, trace_blob_repository
from app.services.live_service import live_registry


async def get_project_stats(db: AsyncSession, project_id: uuid.UUID) -> dict[str, Any]:
    by_outcome = await run_repository.counts_by_status(db, project_id)
    slowest_nodes = await node_stat_repository.top(db, project_id)
    latest_traces = await run_repository.latest(db, project_id)
    p95_elapsed_us = await run_repository.elapsed_percentile(db, project_id)
    total_edge_traversals, total_loop_reentries = await run_repository.sums(db, project_id)
    total_runs = sum(by_outcome.values())
    finished_pct = (by_outcome["finished"] / total_runs * 100) if total_runs else 0.0

    since = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=23)
    rows = await run_repository.hourly_counts(db, project_id, since)
    buckets: dict[datetime, dict[str, int]] = {since + timedelta(hours=h): {"ok": 0, "fail": 0} for h in range(24)}
    for bucket_time, status, count in rows:
        if bucket_time.tzinfo is None:
            bucket_time = bucket_time.replace(tzinfo=timezone.utc)
        bucket = buckets.get(bucket_time)
        if bucket is None:
            continue
        if status == "finished":
            bucket["ok"] += count
        elif status == "failed":
            bucket["fail"] += count
    hourly_bars = [buckets[t] for t in sorted(buckets.keys())]

    return {
        "by_outcome": by_outcome,
        "slowest_nodes": slowest_nodes,
        "latest_traces": latest_traces,
        "p95_elapsed_us": p95_elapsed_us,
        "total_edge_traversals": total_edge_traversals,
        "total_loop_reentries": total_loop_reentries,
        "finished_pct": finished_pct,
        "hourly_bars": hourly_bars,
    }


async def get_run_events(run: Run) -> list[dict[str, Any]]:
    """Dual-source read per DATABASE.md: a running trace's events come from the in-memory
    buffer; a finished/failed trace's come from its MinIO blob (empty if it was sampled
    away — a successful run that was never flushed)."""
    if run.status == "running":
        return live_registry.buffer(str(run.id))
    blob = await run_in_threadpool(trace_blob_repository.get_trace, run.project_id, run.id)
    if blob is None:
        return []
    return [json.loads(line) for line in blob.decode().splitlines() if line]
