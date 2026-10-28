"""Rebuilds per-run node timings (run_node_stats) from stored traces, for runs that finished
before that table existed. Safe to re-run: runs that already have rows are skipped.

Runs whose trace wasn't stored (sampled out) or is in the pre-1.0 format get no rows; the
dashboard's "slowest nodes" simply doesn't include them.

Usage:
  uv run python -m scripts.backfill_run_node_stats
  docker compose exec backend python -m scripts.backfill_run_node_stats
"""

import asyncio
import json

from sqlalchemy import exists, select
from starlette.concurrency import run_in_threadpool

from app.config.db import SessionLocal
from app.models.run import Run, RunNodeStat
from app.repositories import node_stat_repository, trace_blob_repository
from app.services.run_stats import compute_run_stats


async def main() -> None:
    async with SessionLocal() as db:
        pending = (
            await db.execute(
                select(Run).where(Run.status != "running", ~exists().where(RunNodeStat.run_id == Run.id)).order_by(Run.started_at)
            )
        ).scalars().all()
        filled = 0
        for run in pending:
            blob = await run_in_threadpool(trace_blob_repository.get_trace, run.project_id, run.id)
            if not blob:
                continue
            events = [json.loads(line) for line in blob.decode().splitlines() if line]
            visits = compute_run_stats([e for e in events if isinstance(e.get("edge_run_number"), int)]).node_durations
            if visits:
                await node_stat_repository.save_for_run(db, run.project_id, run.id, visits)
                filled += 1
        await db.commit()
        print(f"done — node timings rebuilt for {filled} of {len(pending)} finished runs without them")


if __name__ == "__main__":
    asyncio.run(main())
