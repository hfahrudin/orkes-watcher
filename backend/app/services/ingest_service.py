import json
import random
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.models.project import ApiKey, Project
from app.models.run import Run
from app.repositories import node_stat_repository, project_repository, run_repository, trace_blob_repository
from app.schemas.trace_event import IngestBatch, RunEndEvent
from app.services.live_service import live_registry


async def process_batch(db: AsyncSession, key: ApiKey, batch: IngestBatch) -> None:
    run_id_str = str(batch.run_id)

    run = await run_repository.get(db, batch.run_id)
    if run is None:
        run = await run_repository.create(
            db, run_id=batch.run_id, project_id=key.project_id, graph_name=batch.graph_name, started_at=datetime.now(timezone.utc)
        )
    elif run.status != "running":
        # A duplicate/late run_end (or any event) for an already-finalized run would
        # otherwise silently re-run _finalize against an empty buffer, overwriting correct
        # stats with garbage — confirmed by hand before this guard existed. Reject instead:
        # exactly one run_end per run, and nothing after it, per the traces contract.
        raise HTTPException(status.HTTP_409_CONFLICT, f"Run {batch.run_id} is already {run.status} — cannot ingest further events")

    project = await project_repository.get(db, key.project_id)
    assert project is not None  # the API key's project_id is a live FK, this can't be missing

    for event in batch.events:
        if isinstance(event, RunEndEvent):
            await _finalize(db, project, run, event)
        else:
            await live_registry.publish(run_id_str, event.model_dump(mode="json", by_alias=True))

    await db.commit()


async def _finalize(db: AsyncSession, project: Project, run: Run, event: RunEndEvent) -> None:
    run_id_str = str(run.id)
    buffer = live_registry.buffer(run_id_str)
    node_visits = [e for e in buffer if e.get("kind") == "node"]
    edge_traversals = [e for e in buffer if e.get("kind") == "edge"]

    distinct_nodes = {e["nodeId"] for e in node_visits}
    distinct_edges = {e["edgeId"] for e in edge_traversals}
    loop_count = sum(1 for e in edge_traversals if e.get("passesLeft") is not None)
    finished_at = datetime.now(timezone.utc)
    elapsed_us = int((finished_at - run.started_at).total_seconds() * 1_000_000)

    await run_repository.finish(
        db,
        run,
        status=event.status,
        finished_at=finished_at,
        node_count=len(distinct_nodes),
        edge_count=len(distinct_edges),
        loop_count=loop_count,
        elapsed_us=elapsed_us,
        error=event.error,
    )

    node_durations = []
    for n in node_visits:
        entered, exited = n.get("enteredAt"), n.get("exitedAt")
        if entered and exited:
            duration_us = int((datetime.fromisoformat(exited) - datetime.fromisoformat(entered)).total_seconds() * 1_000_000)
            node_durations.append({"node_id": n["nodeId"], "node_name": n["nodeName"], "duration_us": duration_us})
    await node_stat_repository.upsert_many(db, project.id, node_durations)
    await node_stat_repository.bump_run_counts(db, project.id, distinct_nodes)

    # Sampling applies at finalize, not ingest start — the outcome isn't known until now,
    # and failures are never sampled away. See DATABASE.md.
    should_flush = event.status == "failed" or random.randint(1, 100) <= project.sampling_pct
    if should_flush and buffer:
        ndjson = "\n".join(json.dumps(e) for e in buffer).encode()
        await run_in_threadpool(trace_blob_repository.put_trace, project.id, run.id, ndjson)

    await live_registry.publish_done(run_id_str, event.status)
    live_registry.discard(run_id_str)
