import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.models.run import Run
from app.repositories import node_stat_repository, run_repository, trace_blob_repository
from app.services.run_stats import order_events
from app.services.live_service import live_registry


# Dashboard ranges: (how far back, chart bucket width). Each gives 12-30 bars.
RANGES: dict[str, tuple[timedelta, timedelta]] = {
    "1h": (timedelta(hours=1), timedelta(minutes=5)),
    "24h": (timedelta(hours=24), timedelta(hours=1)),
    "7d": (timedelta(days=7), timedelta(hours=6)),
    "30d": (timedelta(days=30), timedelta(days=1)),
}


async def get_project_stats(db: AsyncSession, project_id: uuid.UUID, *, range_key: str = "24h", graph: str | None = None) -> dict[str, Any]:
    """Every figure covers the same runs: this project, started within the range, and only
    the given graph when one is set."""
    span, bucket = RANGES[range_key]
    now = datetime.now(timezone.utc)
    # Buckets end at the current one; align them to whole bucket widths since the epoch.
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    current = epoch + ((now - epoch) // bucket) * bucket
    count = int(span / bucket)
    first = current - (count - 1) * bucket
    scope = run_repository.Scope(project_id=project_id, since=first, graph=graph)

    by_outcome = await run_repository.counts_by_status(db, scope)
    total_runs = sum(by_outcome.values())
    total_edge_traversals, total_loop_reentries = await run_repository.sums(db, scope)

    buckets = {first + i * bucket: {"start": first + i * bucket, "ok": 0, "fail": 0} for i in range(count)}
    for start, status, n in await run_repository.bucket_counts(db, scope, bucket=bucket, origin=epoch):
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        b = buckets.get(start)
        if b is None:
            continue
        if status == "finished":
            b["ok"] += n
        elif status == "failed":
            b["fail"] += n
    for start, p50, p95 in await run_repository.bucket_durations(db, scope, bucket=bucket, origin=epoch):
        b = buckets.get(start if start.tzinfo else start.replace(tzinfo=timezone.utc))
        if b is not None:
            b["p50_us"], b["p95_us"] = p50, p95

    failures, failures_without_node = await run_repository.failures_by_node(db, scope)
    running, running_count = await run_repository.live_now(db, project_id, graph)

    return {
        "range": range_key,
        "graph": graph,
        "graph_names": await run_repository.graph_names(db, project_id),
        "by_outcome": by_outcome,
        "slowest_nodes": await node_stat_repository.slowest(db, scope),
        "latest_traces": await run_repository.latest(db, scope),
        "p95_elapsed_us": await run_repository.elapsed_percentile(db, scope),
        "total_edge_traversals": total_edge_traversals,
        "total_loop_reentries": total_loop_reentries,
        "finished_pct": (by_outcome["finished"] / total_runs * 100) if total_runs else 0.0,
        "bucket_seconds": int(bucket.total_seconds()),
        "timeline": [buckets[k] for k in sorted(buckets)],
        "top_errors": await run_repository.top_errors(db, scope),
        "failures_by_node": failures,
        "failures_without_node": failures_without_node,
        # Live ignores the time range (it's about now) but respects the graph filter.
        "live": {"running_count": running_count, "running": running, "abandoned_in_range": await run_repository.abandoned_count(db, scope)},
    }


async def get_run_events(run: Run) -> list[dict[str, Any]]:
    """Dual-source read per DATABASE.md: a running trace's events come from the in-memory
    buffer; a finished/failed trace's come from its MinIO blob (empty if it was sampled
    away — a successful run that was never flushed). Events come back exactly as orkes
    sent them (snake_case), ordered by edge_run_number."""
    if run.status == "running":
        return order_events(live_registry.buffer(str(run.id)))
    blob = await run_in_threadpool(trace_blob_repository.get_trace, run.project_id, run.id)
    if blob is None:
        return []
    return [json.loads(line) for line in blob.decode().splitlines() if line]
