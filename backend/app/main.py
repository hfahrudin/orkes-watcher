from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.config.settings import settings
from app.utils.security import hash_password
from app.config.db import SessionLocal
from app.repositories import trace_blob_repository, user_repository
from app.routes import api_keys, auth, ingest, live, members, projects, runs, sessions


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
    yield


app = FastAPI(title="Orkes Watcher API", lifespan=lifespan)

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
