"""Ingest load checks: the real app in-process against the test Postgres + MinIO, driven the
way many orkes WatcherSinks would drive it. Opt-in, not part of a plain `pytest`:

    uv run pytest tests/load -s

These guard against throughput regressions in the backend's own code and queries. They
are not capacity numbers for a deployment: everything runs in one process and one event
loop, with no network in between. Sizes and limits are set with environment variables
(see LoadConfig); the defaults finish in well under a minute on a laptop.
"""

import asyncio
import os
import statistics
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from httpx import AsyncClient

from app.schemas.trace_event import MAX_BATCH_EVENTS
from app.services import abandon_service
from tests.payloads import NODES, auth, batch, edge, project_and_ingest_secret, run_end


def _env(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


@dataclass(frozen=True)
class LoadConfig:
    runs: int = int(_env("ORKES_LOAD_RUNS", 30))
    concurrency: int = int(_env("ORKES_LOAD_CONCURRENCY", 10))
    edges_per_run: int = int(_env("ORKES_LOAD_EDGES_PER_RUN", 100))
    edges_per_batch: int = int(_env("ORKES_LOAD_EDGES_PER_BATCH", 50))  # WatcherSink's flush size
    stale_runs: int = int(_env("ORKES_LOAD_STALE_RUNS", 200))
    # Limits: generous on purpose, to catch large regressions without flaking.
    max_p95_ms: float = _env("ORKES_LOAD_MAX_P95_MS", 1500)
    max_full_batch_s: float = _env("ORKES_LOAD_MAX_FULL_BATCH_S", 10)
    max_sweep_s: float = _env("ORKES_LOAD_MAX_SWEEP_S", 20)


CFG = LoadConfig()


@dataclass
class Latencies:
    samples_ms: list[float] = field(default_factory=list)

    async def post(self, client: AsyncClient, secret: str, body: dict) -> int:
        start = time.perf_counter()
        r = await client.post("/ingest/events", headers=auth(secret), json=body)
        self.samples_ms.append((time.perf_counter() - start) * 1000)
        return r.status_code

    def pct(self, p: float) -> float:
        ordered = sorted(self.samples_ms)
        return ordered[min(len(ordered) - 1, int(len(ordered) * p))]


def report(capsys, title: str, **numbers) -> None:
    with capsys.disabled():
        print(f"\n  [load] {title}")
        for name, value in numbers.items():
            print(f"         {name:<22} {value:,.1f}" if isinstance(value, float) else f"         {name:<22} {value:,}")


def run_events(edges: int) -> list[dict]:
    """A looping run: START -> work -> (check -> work) repeated -> END, so loop counting
    is exercised. Edge ids repeat the way orkes reuses them across loop passes."""
    events = [edge("edge_start", 1, "START", "work")]
    for n in range(2, edges):
        events.append(edge("edge_check", n, "work", "check") if n % 2 == 0 else edge("edge_retry", n, "check", "work"))
    events.append(edge("edge_end", edges, "work", "END"))
    return events


async def test_concurrent_runs(admin_client: AsyncClient, capsys):
    """Many runs at once, each sent like a WatcherSink sends it: node list, edge batches,
    then run_end. Every run must finalize with the right counts."""
    _, secret = await project_and_ingest_secret(admin_client)
    latencies = Latencies()
    gate = asyncio.Semaphore(CFG.concurrency)
    run_ids = [str(uuid.uuid4()) for _ in range(CFG.runs)]
    statuses: list[int] = []

    async def send_run(run_id: str) -> None:
        events = run_events(CFG.edges_per_run)
        chunks = [events[i : i + CFG.edges_per_batch] for i in range(0, len(events), CFG.edges_per_batch)]
        bodies = [batch(run_id, [], nodes=NODES), *(batch(run_id, c) for c in chunks), batch(run_id, [run_end()])]
        async with gate:
            for body in bodies:
                statuses.append(await latencies.post(admin_client, secret, body))

    start = time.perf_counter()
    await asyncio.gather(*(send_run(r) for r in run_ids))
    wall_s = time.perf_counter() - start

    assert set(statuses) == {202}, f"non-202 responses: {sorted(set(statuses) - {202})}"
    expected_loops = CFG.edges_per_run - 4  # every edge except the first, last, and first pass of check/retry
    for run_id in run_ids:
        run = (await admin_client.get(f"/runs/{run_id}")).json()
        assert run["status"] == "finished"
        assert run["edgeCount"] == CFG.edges_per_run
        assert run["loopCount"] == expected_loops

    total_events = CFG.runs * CFG.edges_per_run
    report(
        capsys,
        f"{CFG.runs} runs x {CFG.edges_per_run} edges, concurrency {CFG.concurrency}",
        requests=len(latencies.samples_ms),
        wall_seconds=wall_s,
        events_per_second=total_events / wall_s,
        requests_per_second=len(latencies.samples_ms) / wall_s,
        p50_ms=statistics.median(latencies.samples_ms),
        p95_ms=latencies.pct(0.95),
        max_ms=max(latencies.samples_ms),
    )
    assert latencies.pct(0.95) <= CFG.max_p95_ms, f"p95 {latencies.pct(0.95):.0f} ms over the {CFG.max_p95_ms:.0f} ms limit"


async def test_full_size_batch(admin_client: AsyncClient, capsys):
    """One batch at the contract's 5000-event limit, then run_end: accepted, finalized,
    and every event readable back in order."""
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    events = run_events(MAX_BATCH_EVENTS)
    latencies = Latencies()

    assert await latencies.post(admin_client, secret, batch(run_id, events, nodes=NODES)) == 202
    assert await latencies.post(admin_client, secret, batch(run_id, [run_end()])) == 202

    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "finished" and run["edgeCount"] == MAX_BATCH_EVENTS
    start = time.perf_counter()
    stored = (await admin_client.get(f"/runs/{run_id}/events")).json()
    read_ms = (time.perf_counter() - start) * 1000
    assert [e["edge_run_number"] for e in stored] == list(range(1, MAX_BATCH_EVENTS + 1))

    ingest_s, finalize_s = (ms / 1000 for ms in latencies.samples_ms)
    report(capsys, f"one {MAX_BATCH_EVENTS:,}-event batch", ingest_seconds=ingest_s, finalize_seconds=finalize_s, read_back_ms=read_ms)
    assert ingest_s + finalize_s <= CFG.max_full_batch_s


async def test_abandon_sweep_with_many_stale_runs(admin_client: AsyncClient, capsys):
    """Many runs that never sent run_end: one sweep marks them all abandoned in bounded time."""
    _, secret = await project_and_ingest_secret(admin_client)
    gate = asyncio.Semaphore(CFG.concurrency)

    async def start_run() -> int:
        async with gate:
            r = await admin_client.post("/ingest/events", headers=auth(secret), json=batch(str(uuid.uuid4()), run_events(10), nodes=NODES))
            return r.status_code

    assert set(await asyncio.gather(*(start_run() for _ in range(CFG.stale_runs)))) == {202}

    start = time.perf_counter()
    abandoned = await abandon_service.sweep_abandoned(datetime.now(timezone.utc) + timedelta(minutes=31))
    sweep_s = time.perf_counter() - start

    assert abandoned == CFG.stale_runs
    report(capsys, f"abandon sweep over {CFG.stale_runs} stale runs", sweep_seconds=sweep_s, runs_per_second=CFG.stale_runs / sweep_s)
    assert sweep_s <= CFG.max_sweep_s
