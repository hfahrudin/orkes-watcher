import uuid

from httpx import AsyncClient


async def _project_and_ingest_secret(admin_client: AsyncClient) -> tuple[str, str]:
    project = (await admin_client.post("/projects", json={"name": "support-triage", "env": "production"})).json()
    key = (await admin_client.post(f"/projects/{project['id']}/keys", json={"label": "k", "scope": "ingest"})).json()
    return project["id"], key["secret"]


def _happy_path_events(run_id: str) -> dict:
    return {
        "runId": run_id,
        "graphName": "support-triage",
        "events": [
            {"kind": "node", "nodeId": "START", "nodeName": "Start", "seq": 0, "visitIndex": 1, "enteredAt": "2026-08-23T09:00:00Z", "exitedAt": "2026-08-23T09:00:00.005Z"},
            {"kind": "edge", "edgeId": "e1", "fromNode": "START", "toNode": "classify", "edgeType": "forward", "runSeq": 1, "elapsedUs": 5000, "stateSnapshot": {"input": "hi"}, "fnCalls": []},
            {"kind": "node", "nodeId": "classify", "nodeName": "Classify", "seq": 2, "visitIndex": 1, "enteredAt": "2026-08-23T09:00:00.005Z", "exitedAt": "2026-08-23T09:00:00.180Z"},
            {"kind": "edge", "edgeId": "e2", "fromNode": "classify", "toNode": "END", "edgeType": "forward", "runSeq": 3, "elapsedUs": 175000, "stateSnapshot": {}, "fnCalls": []},
            {"kind": "node", "nodeId": "END", "nodeName": "End", "seq": 4, "visitIndex": 1, "enteredAt": "2026-08-23T09:00:00.180Z", "exitedAt": "2026-08-23T09:00:00.180Z"},
            {"kind": "run_end", "status": "finished"},
        ],
    }


async def test_ingest_requires_valid_key(admin_client: AsyncClient):
    r = await admin_client.post("/ingest/events", headers={"Authorization": "Bearer ok_live_bad_wrong"}, json={"runId": str(uuid.uuid4()), "graphName": "g", "events": []})
    assert r.status_code == 401


async def test_read_scope_key_cannot_ingest(admin_client: AsyncClient):
    project_id, _ = await _project_and_ingest_secret(admin_client)
    read_key = (await admin_client.post(f"/projects/{project_id}/keys", json={"label": "r", "scope": "read"})).json()
    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {read_key['secret']}"}, json={"runId": str(uuid.uuid4()), "graphName": "g", "events": []})
    assert r.status_code == 403


async def test_revoked_key_cannot_ingest(admin_client: AsyncClient):
    project = (await admin_client.post("/projects", json={"name": "p", "env": "local"})).json()
    key = (await admin_client.post(f"/projects/{project['id']}/keys", json={"label": "k", "scope": "ingest"})).json()
    await admin_client.delete(f"/projects/{project['id']}/keys/{key['key']['id']}")
    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {key['secret']}"}, json={"runId": str(uuid.uuid4()), "graphName": "g", "events": []})
    assert r.status_code == 401


async def test_malformed_run_id_is_a_clean_422_not_a_500(admin_client: AsyncClient):
    """Regression test: runId was typed as `str` in IngestBatch, so a non-UUID value
    passed Pydantic validation and only failed later binding a UUID column, as a raw 500."""
    _, secret = await _project_and_ingest_secret(admin_client)
    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json={"runId": "not-a-uuid-at-all", "graphName": "g", "events": []})
    assert r.status_code == 422


async def test_full_ingest_finalizes_run_and_computes_stats(admin_client: AsyncClient):
    project_id, secret = await _project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())

    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json=_happy_path_events(run_id))
    assert r.status_code == 202

    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "finished"
    assert run["nodeCount"] == 3
    assert run["edgeCount"] == 2
    assert run["loopCount"] == 0
    assert run["elapsedUs"] > 0

    events = (await admin_client.get(f"/runs/{run_id}/events")).json()
    assert [e["kind"] for e in events] == ["node", "edge", "node", "edge", "node"]

    stats = (await admin_client.get(f"/projects/{project_id}/stats")).json()
    assert stats["byOutcome"] == {"running": 0, "finished": 1, "failed": 0}
    assert stats["finishedPct"] == 100.0
    node_by_id = {n["nodeId"]: n for n in stats["slowestNodes"]}
    assert node_by_id["classify"]["runCount"] == 1
    assert node_by_id["classify"]["visitCount"] == 1
    assert len(stats["hourlyBars"]) == 24


async def test_loop_count_from_passes_left(admin_client: AsyncClient):
    project_id, secret = await _project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    events = {
        "runId": run_id,
        "graphName": "g",
        "events": [
            {"kind": "node", "nodeId": "a", "nodeName": "A", "seq": 0, "visitIndex": 1, "enteredAt": "2026-08-23T09:00:00Z", "exitedAt": "2026-08-23T09:00:00.010Z"},
            {"kind": "edge", "edgeId": "loop1", "fromNode": "a", "toNode": "a", "edgeType": "conditional", "runSeq": 1, "passesLeft": 2, "elapsedUs": 1000, "stateSnapshot": {}, "fnCalls": []},
            {"kind": "run_end", "status": "finished"},
        ],
    }
    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json=events)
    assert r.status_code == 202
    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["loopCount"] == 1


async def test_two_visits_of_same_node_increment_visit_count_not_run_count(admin_client: AsyncClient):
    """Regression test for a real bug: run_count was double-counted (upsert_many seeded
    it to 1 AND bump_run_counts added another 1) — see the conversation history fixing
    node_stat_repository.py. One run touching a node once must leave run_count == 1."""
    project_id, secret = await _project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json=_happy_path_events(run_id))
    assert r.status_code == 202

    stats = (await admin_client.get(f"/projects/{project_id}/stats")).json()
    node_by_id = {n["nodeId"]: n for n in stats["slowestNodes"]}
    assert node_by_id["START"]["runCount"] == 1
    assert node_by_id["START"]["visitCount"] == 1


async def test_unknown_event_kind_does_not_break_the_batch(admin_client: AsyncClient):
    """Regression test: a future SDK event kind the backend doesn't recognize yet must not
    422 the whole batch — see schemas/trace_event.py's UnknownEvent."""
    project_id, secret = await _project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    events = {
        "runId": run_id,
        "graphName": "g",
        "events": [
            {"kind": "node", "nodeId": "a", "nodeName": "A", "seq": 0, "visitIndex": 1, "enteredAt": "2026-08-23T09:00:00Z", "exitedAt": "2026-08-23T09:00:00.010Z"},
            {"kind": "checkpoint", "label": "future SDK feature", "memoryMb": 128},
            {"kind": "run_end", "status": "finished"},
        ],
    }
    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json=events)
    assert r.status_code == 202

    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "finished"
    assert run["nodeCount"] == 1  # the unknown event didn't get counted as a node or edge

    stored = (await admin_client.get(f"/runs/{run_id}/events")).json()
    checkpoint = next(e for e in stored if e["kind"] == "checkpoint")
    assert checkpoint["label"] == "future SDK feature"
    assert checkpoint["memoryMb"] == 128


async def test_extra_field_on_known_event_survives(admin_client: AsyncClient):
    """Regression test: Pydantic's default extra='ignore' was silently dropping any field
    the schema didn't declare yet — see PassthroughModel in schemas/trace_event.py."""
    project_id, secret = await _project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    events = {
        "runId": run_id,
        "graphName": "g",
        "events": [
            {"kind": "edge", "edgeId": "e1", "fromNode": "a", "toNode": "b", "edgeType": "not-a-known-type", "runSeq": 1, "elapsedUs": 1000, "stateSnapshot": {}, "fnCalls": [], "retryCount": 3},
            {"kind": "run_end", "status": "finished"},
        ],
    }
    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json=events)
    assert r.status_code == 202

    stored = (await admin_client.get(f"/runs/{run_id}/events")).json()
    edge = next(e for e in stored if e["kind"] == "edge")
    assert edge["retryCount"] == 3
    assert edge["edgeType"] == "not-a-known-type"


async def test_events_after_run_end_are_rejected_not_silently_applied(admin_client: AsyncClient):
    """Regression test for a real bug: a duplicate/late run_end used to silently re-run
    _finalize against an empty buffer, overwriting a correctly-finalized run's stats with
    garbage (nodeCount 1 -> 0, status finished -> failed) — confirmed by hand before the
    guard in ingest_service.py existed. Now the whole run is a terminal state once
    finalized: further batches for the same run_id get 409, and the original stats survive
    untouched."""
    project_id, secret = await _project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json=_happy_path_events(run_id))
    assert r.status_code == 202

    original = (await admin_client.get(f"/runs/{run_id}")).json()

    dup = {"runId": run_id, "graphName": "g", "events": [{"kind": "run_end", "status": "failed", "error": "oops"}]}
    r = await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json=dup)
    assert r.status_code == 409

    unchanged = (await admin_client.get(f"/runs/{run_id}")).json()
    assert unchanged == original


async def test_run_not_visible_to_non_member(admin_client: AsyncClient, login_as):
    project_id, secret = await _project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    await admin_client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json=_happy_path_events(run_id))

    outsider = await login_as("outsider@test.local", "developer")
    assert (await outsider.get(f"/runs/{run_id}")).status_code == 403
    assert (await outsider.get(f"/projects/{project_id}/stats")).status_code == 403
