import uuid
from datetime import datetime, timedelta, timezone

from httpx import AsyncClient

import app.config.db as db_module
from app.repositories import run_repository


async def test_delete_expired_only_touches_its_own_project(admin_client: AsyncClient):
    """Regression test: delete_expired had no project_id filter, so running retention for
    one project would delete every other project's expired runs too."""
    project_a = (await admin_client.post("/projects", json={"name": "a", "env": "local"})).json()
    project_b = (await admin_client.post("/projects", json={"name": "b", "env": "local"})).json()

    old = datetime.now(timezone.utc) - timedelta(days=90)
    async with db_module.SessionLocal() as db:
        run_a = await run_repository.create(db, run_id=uuid.uuid4(), project_id=uuid.UUID(project_a["id"]), graph_name="g", started_at=old)
        run_b = await run_repository.create(db, run_id=uuid.uuid4(), project_id=uuid.UUID(project_b["id"]), graph_name="g", started_at=old)
        await db.commit()

        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        expired = await run_repository.delete_expired(db, uuid.UUID(project_a["id"]), before=cutoff)
        assert [r.id for r in expired] == [run_a.id]
        for r in expired:
            await db.delete(r)
        await db.commit()

        assert await run_repository.get(db, run_a.id) is None
        assert await run_repository.get(db, run_b.id) is not None
