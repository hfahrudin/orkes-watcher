"""Live stream tests: a fake orkes sink streams runs batch by batch while dashboard viewers
watch over the WebSocket (`WS /runs/:id/live`), the way the real integration will run.

Uses Starlette's sync TestClient, because httpx's test transport can't open WebSockets.
Inside `with TestClient(app)`, HTTP calls and WebSockets share one event loop, so the
in-memory live registry behaves as it does in a real backend process.
"""

import json
import queue
from datetime import datetime, timedelta, timezone

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import app.config.db as db_module
from app.main import app
from app.repositories import user_repository
from app.services import abandon_service
from app.utils.security import hash_password
from tests.orkes_sim import FakeWatcherSink, graph_nodes, scenario, stream


@pytest.fixture
def client():
    with TestClient(app) as c:  # runs lifespan: bootstrap admin, MinIO bucket
        r = c.post("/auth/login", json={"email": "admin@test.local", "password": "test-password"})
        assert r.status_code == 200, r.text
        yield c


@pytest.fixture
def secret(client: TestClient) -> str:
    project = client.post("/projects", json={"name": "support-triage", "env": "production"}).json()
    return client.post(f"/projects/{project['id']}/keys", json={"label": "sink", "scope": "ingest"}).json()["secret"]


def send(client: TestClient, secret: str, body: dict) -> None:
    r = client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json=body)
    assert r.status_code == 202, r.text


def next_message(ws, timeout: float = 5.0) -> dict:
    """Like ws.receive_json(), but fails instead of hanging if nothing arrives. Reads the
    session's internal queue because WebSocketTestSession.receive() has no timeout."""
    try:
        message = ws._send_queue.get(timeout=timeout)
    except queue.Empty:
        pytest.fail(f"no WebSocket message within {timeout}s")
    if isinstance(message, BaseException):
        raise message
    if message["type"] == "websocket.close":
        raise WebSocketDisconnect(message.get("code", 1000))
    return json.loads(message["text"])


def read_until_done(ws) -> tuple[list[dict], str]:
    """(edge events in arrival order, final status) for one live stream."""
    events = []
    while True:
        message = next_message(ws)
        if message["type"] == "done":
            return events, message["status"]
        assert message["type"] == "event"
        events.append(message["data"])


async def create_user(email: str, role: str, password: str = "test-password") -> None:
    async with db_module.SessionLocal() as db:
        await user_repository.create(db, email=email, name=email.split("@")[0], password_hash=hash_password(password), role=role, status="active")
        await db.commit()


def run_numbers(events: list[dict]) -> list[int]:
    return [e["edge_run_number"] for e in events]


# --- a viewer watching a run from start to end -----------------------------------------


def test_viewer_sees_every_edge_of_a_streamed_run(client, secret):
    edges, end = scenario("parallel")
    sink = FakeWatcherSink(flush_every=2)
    bodies = stream(sink, edges, end, nodes=graph_nodes())
    send(client, secret, next(bodies))  # on_run_start: the run now shows as running

    with client.websocket_connect(f"/runs/{sink.run_id}/live") as ws:
        for body in bodies:
            send(client, secret, body)
        received, status = read_until_done(ws)

    assert status == "finished"
    assert sorted(run_numbers(received)) == list(range(1, len(edges) + 1))
    # Arrival order is orkes's append order (parallel parent after its branches), so a
    # viewer must sort by edge_run_number itself (agreement F4).
    assert run_numbers(received) == run_numbers(edges)
    assert run_numbers(received) != sorted(run_numbers(received))
    # Events reach the viewer exactly as orkes sent them.
    parent = next(e for e in received if e["edge_type"] == "__parallel__")
    assert parent["to_node"] == ["tool_search", "tool_faq"]
    assert parent["node_elapsed"] == 0.04 and "elapsed" in parent and "edgeRunNumber" not in parent

    run = client.get(f"/runs/{sink.run_id}").json()
    assert run["status"] == "finished"
    assert run["edgeCount"] == len(edges)
    assert len(run["graphNodes"]) == len(graph_nodes())


def test_viewer_sees_run_status_change_from_running_to_finished(client, secret):
    edges, end = scenario("simple")
    sink = FakeWatcherSink(flush_every=1)
    send(client, secret, sink.on_run_start(graph_nodes()))
    assert client.get(f"/runs/{sink.run_id}").json()["status"] == "running"

    send(client, secret, sink.on_edge(edges[0]))
    live = client.get(f"/runs/{sink.run_id}/events").json()
    assert run_numbers(live) == [1]  # partway through, the events endpoint serves the live buffer
    assert client.get(f"/runs/{sink.run_id}").json()["status"] == "running"

    for e in edges[1:]:
        send(client, secret, sink.on_edge(e))
    send(client, secret, sink.on_run_end(end))
    assert client.get(f"/runs/{sink.run_id}").json()["status"] == "finished"


def test_viewer_of_a_crashing_run_gets_failed_status(client, secret):
    edges, end = scenario("crash")
    sink = FakeWatcherSink(flush_every=1)
    bodies = stream(sink, edges, end, nodes=graph_nodes())
    send(client, secret, next(bodies))

    with client.websocket_connect(f"/runs/{sink.run_id}/live") as ws:
        for body in bodies:
            send(client, secret, body)
        received, status = read_until_done(ws)

    assert status == "failed"
    assert received[-1]["to_node"] == "N/A"
    run = client.get(f"/runs/{sink.run_id}").json()
    assert run["failedNode"] == "classify"
    assert run["error"].startswith("KeyError: 'intent'")


def test_time_based_flushes_reach_the_viewer_one_by_one(client, secret):
    """The real sink also sends every 0.5 s with fewer than 50 events queued: each partial
    batch must show up for the viewer as soon as it's sent, not only at run_end."""
    edges, end = scenario("retry_loop")
    sink = FakeWatcherSink(flush_every=50)  # never fills: only the timer sends
    send(client, secret, sink.on_run_start(graph_nodes()))

    with client.websocket_connect(f"/runs/{sink.run_id}/live") as ws:
        for e in edges:
            sink.on_edge(e)
            send(client, secret, sink.flush())  # the 0.5 s timer firing after each edge
            assert next_message(ws)["data"]["edge_run_number"] == e["edge_run_number"]
        send(client, secret, sink.on_run_end(end))
        assert next_message(ws) == {"type": "done", "status": "finished"}

    assert client.get(f"/runs/{sink.run_id}").json()["loopCount"] == 3


# --- joining late and several viewers --------------------------------------------------


def test_late_viewer_subscribing_then_fetching_misses_nothing(client, secret):
    """A viewer opening a run halfway: subscribe first, then fetch what already arrived,
    then merge by edge_run_number. That order leaves no gap (agreement F4)."""
    edges, end = scenario("parallel")
    sink = FakeWatcherSink(flush_every=2)
    bodies = list(stream(sink, edges, end, nodes=graph_nodes()))
    half = len(bodies) // 2
    for body in bodies[:half]:
        send(client, secret, body)

    with client.websocket_connect(f"/runs/{sink.run_id}/live") as ws:
        already = client.get(f"/runs/{sink.run_id}/events").json()
        for body in bodies[half:]:
            send(client, secret, body)
        live, status = read_until_done(ws)

    merged = {e["edge_run_number"]: e for e in [*already, *live]}
    assert status == "finished"
    assert sorted(merged) == list(range(1, len(edges) + 1))
    assert already and live  # both halves were really exercised
    assert run_numbers(already) == sorted(run_numbers(already))  # the fetched part comes back ordered


def test_two_viewers_of_one_run_both_get_everything(client, secret):
    edges, end = scenario("simple")
    sink = FakeWatcherSink(flush_every=1)
    bodies = stream(sink, edges, end, nodes=graph_nodes())
    send(client, secret, next(bodies))

    with client.websocket_connect(f"/runs/{sink.run_id}/live") as a, client.websocket_connect(f"/runs/{sink.run_id}/live") as b:
        for body in bodies:
            send(client, secret, body)
        got_a, got_b = read_until_done(a), read_until_done(b)

    assert got_a == got_b
    assert run_numbers(got_a[0]) == [1, 2, 3]


def test_interleaved_runs_stay_on_their_own_streams(client, secret):
    """Two graphs running at once through their sinks: each viewer sees only its run."""
    (edges_a, end_a), (edges_b, end_b) = scenario("parallel"), scenario("retry_loop")
    sink_a, sink_b = FakeWatcherSink(flush_every=1), FakeWatcherSink(flush_every=1)
    bodies_a = list(stream(sink_a, edges_a, end_a, nodes=graph_nodes()))
    bodies_b = list(stream(sink_b, edges_b, end_b, nodes=graph_nodes()))
    send(client, secret, bodies_a.pop(0))
    send(client, secret, bodies_b.pop(0))

    with client.websocket_connect(f"/runs/{sink_a.run_id}/live") as ws_a, client.websocket_connect(f"/runs/{sink_b.run_id}/live") as ws_b:
        for i in range(max(len(bodies_a), len(bodies_b))):
            for bodies in (bodies_a, bodies_b):
                if i < len(bodies):
                    send(client, secret, bodies[i])
        got_a, status_a = read_until_done(ws_a)
        got_b, status_b = read_until_done(ws_b)

    assert (status_a, status_b) == ("finished", "finished")
    assert run_numbers(got_a) == run_numbers(edges_a)
    assert run_numbers(got_b) == run_numbers(edges_b)
    assert {e["from_node"] for e in got_b} <= {"START", "classify", "retrieve", "escalate"}


# --- runs that end without run_end, and finished runs ----------------------------------


def test_abandoned_run_ends_the_live_stream(client, secret):
    """The orkes process dies mid-run: no run_end ever comes. The sweep must end the
    viewer's stream with a failed status instead of leaving it open forever."""
    edges, _ = scenario("parallel")
    sink = FakeWatcherSink(flush_every=2)
    bodies = stream(sink, edges[:3], None, nodes=graph_nodes())  # crashed after 3 edges
    send(client, secret, next(bodies))

    with client.websocket_connect(f"/runs/{sink.run_id}/live") as ws:
        for body in bodies:
            send(client, secret, body)
        later = datetime.now(timezone.utc) + timedelta(minutes=31)
        assert client.portal.call(abandon_service.sweep_abandoned, later) == 1
        received, status = read_until_done(ws)

    assert status == "failed"
    assert len(received) == 3
    run = client.get(f"/runs/{sink.run_id}").json()
    assert run["error"] == "abandoned: no run_end received"
    assert sorted(run_numbers(client.get(f"/runs/{sink.run_id}/events").json())) == sorted(run_numbers(edges[:3]))


def test_socket_for_a_finished_run_closes_right_away(client, secret):
    edges, end = scenario("simple")
    sink = FakeWatcherSink()
    for body in stream(sink, edges, end, nodes=graph_nodes()):
        send(client, secret, body)

    with client.websocket_connect(f"/runs/{sink.run_id}/live") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            next_message(ws)
    assert closed.value.code == 1000  # finished runs are read from GET /runs/:id/events


# --- access ----------------------------------------------------------------------------


def test_socket_needs_a_session(client, secret):
    sink = FakeWatcherSink()
    send(client, secret, sink.on_run_start(graph_nodes()))
    anonymous = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as rejected:
        with anonymous.websocket_connect(f"/runs/{sink.run_id}/live"):
            pass
    assert rejected.value.code == 1008


def test_socket_rejects_non_members(client, secret):
    sink = FakeWatcherSink()
    send(client, secret, sink.on_run_start(graph_nodes()))
    client.portal.call(create_user, "outsider@test.local", "developer")
    outsider = TestClient(app)
    assert outsider.post("/auth/login", json={"email": "outsider@test.local", "password": "test-password"}).status_code == 200
    with pytest.raises(WebSocketDisconnect) as rejected:
        with outsider.websocket_connect(f"/runs/{sink.run_id}/live"):
            pass
    assert rejected.value.code == 1008


def test_socket_rejects_an_expired_session(client, secret):
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import update

    from app.models.identity import Session

    sink = FakeWatcherSink()
    send(client, secret, sink.on_run_start(graph_nodes()))

    async def expire(token: str) -> None:
        async with db_module.SessionLocal() as db:
            await db.execute(update(Session).where(Session.id == token).values(created_at=datetime.now(timezone.utc) - timedelta(days=31)))
            await db.commit()

    client.portal.call(expire, client.cookies["orkes_session"])
    with pytest.raises(WebSocketDisconnect) as rejected:
        with client.websocket_connect(f"/runs/{sink.run_id}/live"):
            pass
    assert rejected.value.code == 1008
