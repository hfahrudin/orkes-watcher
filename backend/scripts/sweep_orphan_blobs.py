"""Deletes MinIO trace blobs whose `runs` row no longer exists.

Companion to scripts/retention.py, which deletes the blob before the Postgres row (see
DATABASE.md) — a crash or error between those two steps leaves an orphaned blob that
retention.py itself will never revisit. Run this on a slower cadence (e.g. daily) than
retention.py.

Usage: uv run python -m scripts.sweep_orphan_blobs
"""

import asyncio

from app.config.db import SessionLocal
from app.repositories import run_repository, trace_blob_repository


async def main() -> None:
    async with SessionLocal() as db:
        stored = trace_blob_repository.list_object_ids()
        orphans = 0
        for project_id, run_id in stored:
            if await run_repository.get(db, run_id) is None:
                trace_blob_repository.delete_trace(project_id, run_id)
                orphans += 1
        print(f"done — {orphans} orphaned blobs deleted out of {len(stored)} checked")


if __name__ == "__main__":
    asyncio.run(main())
