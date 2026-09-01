import os

# Must be set before anything imports app.config.settings (module-level singleton) — a
# dedicated test DB/bucket, never the dev or prod ones. See tests/README or the command in
# CONTRIBUTING for spinning up throwaway Postgres/MinIO containers to point these at.
os.environ.setdefault("ORKES_DATABASE_URL", "postgresql+asyncpg://orkes:orkes@localhost:5436/orkes_test")
os.environ.setdefault("ORKES_MINIO_ENDPOINT", "localhost:9002")
os.environ.setdefault("ORKES_MINIO_ACCESS_KEY", "orkes")
os.environ.setdefault("ORKES_MINIO_SECRET_KEY", "orkes12345")
os.environ.setdefault("ORKES_MINIO_BUCKET", "orkes-traces-test")
os.environ.setdefault("ORKES_BOOTSTRAP_ADMIN_EMAIL", "admin@test.local")
os.environ.setdefault("ORKES_BOOTSTRAP_ADMIN_PASSWORD", "test-password")

import app.config.db as db_module
from app.config.settings import settings
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# pytest-asyncio gives each test function its own event loop by default, but
# app.config.db's module-level `engine` is a singleton created once at import time — its
# pooled connections end up bound to whatever loop first used them, and a later test's loop
# then hits "Future attached to a different loop". NullPool never holds a connection across
# checkouts, sidestepping the issue — only swapped in for tests, not production, since it
# gives up real connection pooling.
#
# This MUST happen before anything imports app.main (directly or transitively) — app.main
# and app.routes.live both do `from app.config.db import SessionLocal`, which binds their
# own module-level name to whatever db_module.SessionLocal IS at that moment. Patching the
# attribute on db_module after that import wouldn't reach those already-bound names.
db_module.engine = create_async_engine(settings.database_url, poolclass=NullPool)
db_module.SessionLocal = async_sessionmaker(db_module.engine, expire_on_commit=False)
SessionLocal = db_module.SessionLocal

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config.db import Base
from app.main import app, lifespan
from app.repositories import user_repository
from app.utils.security import hash_password


@pytest_asyncio.fixture(autouse=True)
async def _reset_db():
    async with db_module.engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest_asyncio.fixture
async def client():
    async with lifespan(app):  # runs bootstrap-admin creation + ensures the MinIO bucket
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


@pytest_asyncio.fixture
async def admin_client(client: AsyncClient) -> AsyncClient:
    r = await client.post("/auth/login", json={"email": "admin@test.local", "password": "test-password"})
    assert r.status_code == 200, r.text
    return client


async def make_user(email: str, role: str, password: str = "test-password") -> None:
    """Creates a user with a known, usable password directly via the repository — there's
    no public signup or activation flow to go through yet (see member_service.py's
    invite_member note), so tests that need a non-admin session seed one this way."""
    async with SessionLocal() as db:
        await user_repository.create(db, email=email, name=email.split("@")[0], password_hash=hash_password(password), role=role, status="active")
        await db.commit()


@pytest_asyncio.fixture
async def login_as(client: AsyncClient):
    """Depends on `client` only to guarantee `_reset_db`/`lifespan` already ran — each call
    returns its own independent AsyncClient (own cookie jar) against the same in-process
    app, so a test can hold two simultaneous identities (e.g. an admin and a viewer)
    without one login's cookie clobbering the other's."""
    opened: list[AsyncClient] = []

    async def _login(email: str, role: str, password: str = "test-password") -> AsyncClient:
        await make_user(email, role, password)
        ac = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        opened.append(ac)
        r = await ac.post("/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        return ac

    yield _login
    for ac in opened:
        await ac.aclose()
