# Orkes Watcher backend

FastAPI backend implementing the ingest, query, and live gateway described in
`working_context/ARCHITECTURE.md` and `working_context/API.md` — MVP shape: one process,
Postgres for run metadata/aggregates, MinIO for raw trace blobs, no bus yet.

## Structure

Layered by responsibility, not by feature — `routes/` (HTTP), `services/` (business logic),
`repositories/` (Postgres/MinIO access), `models/` (SQLAlchemy tables, grouped by domain:
`identity`, `project`, `run`), `schemas/` (Pydantic request/response shapes, same domain
grouping), `config/` (settings, DB engine, auth dependencies), `utils/` (pure helpers —
password/API-key hashing).

## Running it

**Via the root `docker-compose.yml`** (recommended — brings up Postgres and MinIO too):

```bash
cd .. && docker compose up -d --build backend
```

**Locally**, against Postgres/MinIO running some other way:

```bash
uv sync
cp .env.example .env   # then edit to point at your Postgres/MinIO
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

The first startup creates a bootstrap admin (`ORKES_BOOTSTRAP_ADMIN_EMAIL`/`_PASSWORD`) if
no users exist yet.

## Migrations

Alembic, configured in `alembic/env.py` to read `app.models`'s metadata directly (no
manually-maintained `target_metadata`).

```bash
uv run alembic revision --autogenerate -m "add whatever"
uv run alembic upgrade head
```

`ddl.sql` at the repo root is a generated snapshot (`pg_dump --schema-only`) for
bootstrapping a fresh Postgres in one shot without replaying migration history — regenerate
it after schema changes rather than hand-editing it (see its header comment).

## Background scripts

Not triggered by the API — run on a cron, per `ARCHITECTURE.md`'s MVP cut list ("retention/
sampling automation beyond a manual script").

```bash
uv run python -m scripts.retention            # deletes runs (+ their blobs) past a project's retention_days
uv run python -m scripts.sweep_orphan_blobs   # cleans up blobs whose runs row is already gone
```

## Example data

There's no real SDK yet (it lives in its own repo, per `ARCHITECTURE.md`) — until there is,
`scripts.seed_example_traces` stands in for one. Unlike the two scripts above, it needs the
backend actually running and reachable, since it calls `POST /ingest/events` over real HTTP
exactly as an SDK would, rather than writing to Postgres/MinIO directly:

```bash
docker compose exec backend python -m scripts.seed_example_traces
```

Creates (or reuses) a `support-triage` project and seeds it with a few realistic traces —
a happy path with a parallel branch, a retry loop that escalates, and a minimal one-shot
success. See `working_context/TRACES_CONTRACT.md`.

## Tests

```bash
docker run -d --name orkes-pg-test -e POSTGRES_USER=orkes -e POSTGRES_PASSWORD=orkes -e POSTGRES_DB=orkes_test -p 5436:5432 postgres:16-alpine
docker run -d --name orkes-minio-test -e MINIO_ROOT_USER=orkes -e MINIO_ROOT_PASSWORD=orkes12345 -p 9002:9000 minio/minio server /data
uv run pytest
```

`tests/conftest.py` points at these specific ports (5436/9002) — deliberately separate from
both the dev containers and the docker-compose stack, so running the suite never touches
real data. Each test gets a fresh schema (`Base.metadata.drop_all`/`create_all` per test)
and its own `AsyncClient` against the app in-process — no server process needed.

The one thing not covered by this suite: the WebSocket live gateway (`routes/live.py`).
`httpx`'s ASGI transport doesn't speak WebSocket; it was instead verified manually with a
`websockets` client script exercising the full ingest → live-push → finalize sequence
(subscribe while `running`, receive events as they're ingested, receive the `done` sentinel
on finalize, socket closes) — worth automating if this suite grows a Playwright/websockets
dependency later.
