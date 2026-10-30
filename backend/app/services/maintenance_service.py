"""Background upkeep inside the backend process, every ORKES_ABANDON_SWEEP_INTERVAL_SECONDS:
marks abandoned runs (abandon_service) and removes expired sign-in sessions."""

import asyncio
import logging

from app.config import db as db_module
from app.config.settings import settings
from app.repositories import session_repository
from app.services import abandon_service

log = logging.getLogger(__name__)


async def purge_expired_sessions() -> int:
    async with db_module.SessionLocal() as db:
        removed = await session_repository.delete_expired(db)
        await db.commit()
    return removed


async def run_forever() -> None:
    while True:
        await asyncio.sleep(settings.abandon_sweep_interval_seconds)
        for task, label in ((abandon_service.sweep_abandoned, "abandoned-run sweep"), (purge_expired_sessions, "expired-session cleanup")):
            try:
                count = await task()
                if count:
                    log.info("%s: %d", label, count)
            except Exception:
                log.exception("%s failed; will retry next interval", label)
