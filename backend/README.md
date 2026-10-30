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

One background job runs *inside* the backend process instead: the abandoned-run sweep
(`app/services/abandon_service.py`). Every `ORKES_ABANDON_SWEEP_INTERVAL_SECONDS` (default
60) it marks `running` runs that have had no batch for their project's
`abandon_after_minutes` (default 30) as `failed` with error
`"abandoned: no run_end received"`. It has to run in-process because a running run's events
live in that process's memory until the run ends.

## Ingest contract

`POST /ingest/events` accepts the orkes trace contract **1.0**, defined in
[`docs/contracts/contract-1.0.md`](../docs/contracts/contract-1.0.md) §2 (orkes is the master; the watcher follows its
field names, units and status strings). `GET /version` (no auth) reports the watcher version
and the contract majors it accepts. Trace events are stored and returned exactly as orkes
sent them (snake_case); the rest of the dashboard API is camelCase.

## Example data

Until orkes ships its `WatcherSink`, `scripts.seed_example_traces` stands in for it. Unlike
the two scripts above, it needs the backend actually running and reachable, since it calls
`POST /ingest/events` over real HTTP exactly as the sink will (a first batch with the node
list, then edges, then `run_end`), rather than writing to Postgres/MinIO directly:

```bash
docker compose exec backend python -m scripts.seed_example_traces
```

Creates (or reuses) a `support-triage` project and seeds it with a few realistic traces —
a happy path with a parallel branch, a retry loop that escalates, a crash in a routing gate,
and a minimal one-shot success. See [`docs/contracts/contract-1.0.md`](../docs/contracts/contract-1.0.md).

## Tests

| Folder | What it covers | Needs Postgres/MinIO | Runs with plain `pytest` |
|---|---|---|---|
| `tests/unit/` | Pure logic: run stats, event ordering, the ingest schema, contract versions, key/password helpers | No | Yes |
| `tests/integrations/` | The real app in-process over HTTP and WebSocket: auth, projects, members, keys, ingest, query, retention, abandoned runs, and live streams driven by a fake orkes sink (`test_live_stream.py`) | Yes | Yes |
| `tests/load/` | Throughput and latency under concurrent ingest, a full 5000-event batch, a large abandoned-run sweep | Yes | No (opt-in) |

```bash
docker run -d --name orkes-pg-test -e POSTGRES_USER=orkes -e POSTGRES_PASSWORD=orkes -e POSTGRES_DB=orkes_test -p 5436:5432 postgres:16-alpine
docker run -d --name orkes-minio-test -e MINIO_ROOT_USER=orkes -e MINIO_ROOT_PASSWORD=orkes12345 -p 9002:9000 minio/minio server /data

uv run pytest                    # unit + integrations
uv run pytest tests/unit         # unit only, no containers needed
uv run pytest tests/load -s      # load tests; -s prints the latency/throughput report
```

Load test sizes and limits come from environment variables (`ORKES_LOAD_RUNS`,
`ORKES_LOAD_CONCURRENCY`, `ORKES_LOAD_EDGES_PER_RUN`, `ORKES_LOAD_MAX_P95_MS`, … — see
`LoadConfig` in `tests/load/test_ingest_load.py`). They measure the backend's own code and
queries in one process, not a deployment's capacity.

Shared pieces: `tests/conftest.py` (test DB/MinIO settings, app clients, the `reset_db`
fixture that integrations/ and load/ turn on for every test), `tests/payloads.py`
(builders for orkes-shaped ingest payloads), and `tests/orkes_sim.py` (`FakeWatcherSink`:
streams a run batch by batch the way orkes's sink will, using the seed script's graph
scenarios).

`tests/conftest.py` points at these specific ports (5436/9002) — deliberately separate from
both the dev containers and the docker-compose stack, so running the suite never touches
real data. Each integration/load test gets a fresh schema (`Base.metadata.drop_all`/`create_all`)
and its own `AsyncClient` against the app in-process — no server process needed. The
WebSocket tests use Starlette's `TestClient` instead, since `httpx`'s test transport can't
open WebSockets.
