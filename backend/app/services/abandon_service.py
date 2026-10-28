"""Marks runs that never sent run_end as failed ("abandoned"), per contract §2.2.
Run periodically by maintenance_service.

Runs inside the backend process (not as a cron script like retention.py), because a
running run's events live in this process's in-memory live buffer and must be flushed
from here.
"""

from datetime import datetime, timezone

from app.config import db as db_module
from app.repositories import run_repository
from app.services import ingest_service


async def sweep_abandoned(now: datetime | None = None) -> int:
    """Returns how many runs were marked abandoned."""
    now = now or datetime.now(timezone.utc)
    async with db_module.SessionLocal() as db:
        stale = await run_repository.list_stale_running(db, now)
        for run, project in stale:
            await ingest_service.abandon_run(db, project, run)
        await db.commit()
        for run, _ in stale:
            await ingest_service.end_live_stream(run)
    return len(stale)

