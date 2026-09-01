"""Manual retention sweep — run on a cron, not triggered by the API.

Per ARCHITECTURE.md's MVP cut list: "retention/sampling automation beyond a manual
script." Deletes the MinIO blob before the Postgres row (see DATABASE.md) — a failure
between the two leaves an orphaned blob, swept by scripts/sweep_orphan_blobs.py, rather
than a runs row with a missing blob.

Usage: uv run python -m scripts.retention
"""

import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.config.db import SessionLocal
from app.models.project import Project
from app.repositories import run_repository, trace_blob_repository


async def main() -> None:
    async with SessionLocal() as db:
        projects = (await db.execute(select(Project))).scalars().all()
        total_deleted = 0
        for project in projects:
            cutoff = datetime.now(timezone.utc) - timedelta(days=project.retention_days)
            expired = await run_repository.delete_expired(db, project.id, before=cutoff)
            if not expired:
                continue
            print(f"{project.name} ({project.id}): {len(expired)} runs older than {project.retention_days}d")
            for run in expired:
                trace_blob_repository.delete_trace(project.id, run.id)  # best-effort; NoSuchKey is fine
                await db.delete(run)
            total_deleted += len(expired)
        await db.commit()
        print(f"done — {total_deleted} runs deleted across {len(projects)} projects")


if __name__ == "__main__":
    asyncio.run(main())
