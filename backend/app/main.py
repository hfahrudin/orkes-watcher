import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.config.settings import settings
from app.config.version import LATEST_CONTRACT, SUPPORTED_CONTRACT_MAJORS, WATCHER_VERSION
from app.utils.security import hash_password
from app.config.db import SessionLocal
from app.repositories import trace_blob_repository, user_repository
from app.routes import api_keys, auth, ingest, live, members, projects, runs, sessions
from app.services import abandon_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    await run_in_threadpool(trace_blob_repository.get_client)  # ensures the bucket exists
    async with SessionLocal() as db:
        if await user_repository.count_all(db) == 0:
            await user_repository.create(
                db,
                email=settings.bootstrap_admin_email,
                name=settings.bootstrap_admin_name,
                password_hash=hash_password(settings.bootstrap_admin_password),
                role="admin",
                status="active",
            )
            await db.commit()
    sweep = asyncio.create_task(abandon_service.run_forever()) if settings.abandon_sweep_interval_seconds > 0 else None
    try:
        yield
    finally:
        if sweep:
            sweep.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sweep


app = FastAPI(title="Orkes Watcher API", version=WATCHER_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (auth.router, sessions.router, projects.router, members.router, api_keys.router, ingest.router, runs.router, live.router):
    app.include_router(router)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/version")
async def version():
    """No auth: the orkes sink checks this once per process before sending (contract §2.8)."""
    return {"watcher_version": WATCHER_VERSION, "contract": {"supported_majors": list(SUPPORTED_CONTRACT_MAJORS), "latest": LATEST_CONTRACT}}
