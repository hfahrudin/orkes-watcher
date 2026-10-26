"""Ingest + query tests against the orkes trace contract 1.0
(working_context/INTEGRATION_AGREEMENT.md §2)."""

import uuid
from datetime import datetime, timedelta, timezone

from httpx import AsyncClient

from app.schemas.trace_event import MAX_BATCH_EVENTS, MAX_BODY_BYTES
from app.services import abandon_service
from tests.payloads import NODES, START_TIME, auth, batch, edge, happy_path_events, ingest, node, project_and_ingest_secret, run_end


# --- auth, envelope and limits ---------------------------------------------------------


async def test_ingest_requires_valid_key(admin_client: AsyncClient):
    r = await admin_client.post("/ingest/events", headers=auth("ok_live_bad_wrong"), json=batch(str(uuid.uuid4()), []))
    assert r.status_code == 401


async def test_read_scope_key_cannotingest(admin_client: AsyncClient):
    project_id, _ = await project_and_ingest_secret(admin_client)
    read_key = (await admin_client.post(f"/projects/{project_id}/keys", json={"label": "r", "scope": "read"})).json()
    r = await admin_client.post("/ingest/events", headers=auth(read_key["secret"]), json=batch(str(uuid.uuid4()), []))
    assert r.status_code == 403


async def test_revoked_key_cannotingest(admin_client: AsyncClient):
    project = (await admin_client.post("/projects", json={"name": "p", "env": "local"})).json()
    key = (await admin_client.post(f"/projects/{project['id']}/keys", json={"label": "k", "scope": "ingest"})).json()
    await admin_client.delete(f"/projects/{project['id']}/keys/{key['key']['id']}")
    r = await admin_client.post("/ingest/events", headers=auth(key["secret"]), json=batch(str(uuid.uuid4()), []))
    assert r.status_code == 401


async def test_malformed_run_id_is_a_clean_422_not_a_500(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    await ingest(admin_client, secret, batch("not-a-uuid-at-all", []), expect=422)


async def test_invalid_json_is_422(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    r = await admin_client.post("/ingest/events", headers={**auth(secret), "Content-Type": "application/json"}, content=b"{not json")
    assert r.status_code == 422


async def test_batch_over_max_events_is_rejected(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    events = [edge("e", i, "a", "b") for i in range(1, MAX_BATCH_EVENTS + 2)]
    await ingest(admin_client, secret, batch(str(uuid.uuid4()), events), expect=422)


async def test_body_over_5mb_is_413(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    big = edge("e", 1, "a", "b", state_snapshot={"blob": "x" * (MAX_BODY_BYTES + 1)})
    await ingest(admin_client, secret, batch(str(uuid.uuid4()), [big]), expect=413)


async def test_missing_contract_version_is_422(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    body = batch(str(uuid.uuid4()), [])
    del body["contract_version"]
    await ingest(admin_client, secret, body, expect=422)


async def test_unsupported_contract_major_is_400_with_supported_list(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    # A 2.0 payload may be shaped differently: it must get the version error, not a 422.
    r = await ingest(admin_client, secret, {"contract_version": "2.0", "something": "new"}, expect=400)
    assert r.json() == {"error": "unsupported_contract_version", "supported": ["1"]}


async def test_newer_minor_with_unknown_fields_is_accepted(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    body = batch(str(uuid.uuid4()), [edge("e", 1, "a", "b")], contract_version="1.7")
    body["future_envelope_field"] = True
    await ingest(admin_client, secret, body)


async def test_version_endpoint_needs_noauth(client: AsyncClient):
    r = await client.get("/version")
    assert r.status_code == 200
    body = r.json()
    assert body["contract"] == {"supported_majors": [1], "latest": "1.0"}
    assert body["watcher_version"]


async def test_run_end_must_be_last_inbatch(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    events = [run_end(), edge("e", 1, "a", "b")]
    await ingest(admin_client, secret, batch(str(uuid.uuid4()), events), expect=422)


# --- finalize and stats ----------------------------------------------------------------


async def test_full_ingest_finalizes_run_and_computes_stats(admin_client: AsyncClient):
    project_id, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    await ingest(admin_client, secret, batch(run_id, happy_path_events(), nodes=NODES, description="Routes a ticket."))

    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "finished"  # orkes "FINISHED" mapped to the watcher's status
    assert run["nodeCount"] == 4  # START, classify, answer, END
    assert run["edgeCount"] == 3
    assert run["loopCount"] == 0
    assert run["elapsedUs"] == 2_500_000  # orkes's elapsed_time, not the server clock
    assert datetime.fromisoformat(run["startedAt"]) == datetime.fromtimestamp(START_TIME, timezone.utc)
    assert run["error"] is None and run["failedNode"] is None
    assert run["graphDescription"] == "Routes a ticket."
    assert [n["node_name"] for n in run["graphNodes"]] == ["START", "classify", "answer", "END"]
    assert run["contractVersion"] == "1.0"
    assert run["sdkVersion"] == "0.1.4"

    events = (await admin_client.get(f"/runs/{run_id}/events")).json()
    assert [e["edge_run_number"] for e in events] == [1, 2, 3]
    assert events[1]["edge_type"] == "__conditional__"  # returned exactly as sent, snake_case

    stats = (await admin_client.get(f"/projects/{project_id}/stats")).json()
    assert stats["byOutcome"] == {"running": 0, "finished": 1, "failed": 0}
    assert stats["finishedPct"] == 100.0
    node_by_name = {n["nodeName"]: n for n in stats["slowestNodes"]}
    assert "nodeId" not in node_by_name["classify"]
    assert node_by_name["classify"]["runCount"] == 1
    assert node_by_name["classify"]["visitCount"] == 1
    # node_elapsed (0.3s), not the edge's elapsed (0.4s, which includes the gate)
    assert node_by_name["classify"]["totalDurationUs"] == 300_000
    assert stats["slowestNodes"][0]["nodeName"] == "answer"
    assert len(stats["hourlyBars"]) == 24


async def test_run_list_does_not_include_node_list(admin_client: AsyncClient):
    project_id, secret = await project_and_ingest_secret(admin_client)
    await ingest(admin_client, secret, batch(str(uuid.uuid4()), happy_path_events(), nodes=NODES))
    runs = (await admin_client.get(f"/projects/{project_id}/runs")).json()
    assert "graphNodes" not in runs[0]
    assert runs[0]["sdkVersion"] == "0.1.4"


async def test_loop_count_is_repeat_traversals_of_sameedge(admin_client: AsyncClient):
    """passes_left is always set by orkes, so it must not be read as a loop signal."""
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    events = [
        edge("edge_start", 1, "START", "classify"),
        edge("edge_retry", 2, "classify", "classify", edge_type="__conditional__"),
        edge("edge_retry", 3, "classify", "classify", edge_type="__conditional__"),
        edge("edge_retry", 4, "classify", "answer", edge_type="__conditional__"),
        edge("edge_end", 5, "answer", "END"),
        run_end(),
    ]
    await ingest(admin_client, secret, batch(run_id, events))
    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["loopCount"] == 2
    assert run["edgeCount"] == 5


async def test_loop_visits_add_up_in_node_stats(admin_client: AsyncClient):
    project_id, secret = await project_and_ingest_secret(admin_client)
    events = [
        edge("edge_retry", 1, "classify", "classify", node_elapsed=0.2),
        edge("edge_retry", 2, "classify", "END", node_elapsed=0.3),
        run_end(),
    ]
    await ingest(admin_client, secret, batch(str(uuid.uuid4()), events))
    stats = (await admin_client.get(f"/projects/{project_id}/stats")).json()
    classify = next(n for n in stats["slowestNodes"] if n["nodeName"] == "classify")
    assert classify["visitCount"] == 2
    assert classify["runCount"] == 1  # regression: run_count was once double-counted
    assert classify["totalDurationUs"] == 500_000


async def test_parallel_edge_counts_branches_and_uses_node_elapsed(admin_client: AsyncClient):
    """A parallel edge's `elapsed` includes every branch; node stats must use node_elapsed
    so the source node isn't charged for its branches (decision D3)."""
    project_id, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    # Branch edges arrive before their parent parallel edge, as orkes appends them.
    events = [
        edge("edge_start", 1, "START", "split"),
        edge("edge_a", 3, "branch_a", "merge", node_elapsed=2.0, elapsed=2.0),
        edge("edge_b", 4, "branch_b", "merge", node_elapsed=3.0, elapsed=3.0),
        edge("edge_split", 2, "split", ["branch_a", "branch_b"], edge_type="__parallel__", elapsed=5.1, node_elapsed=0.1),
        edge("edge_end", 5, "merge", "END"),
        run_end(),
    ]
    await ingest(admin_client, secret, batch(run_id, events))

    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["nodeCount"] == 6  # START, split, branch_a, branch_b, merge, END

    stored = (await admin_client.get(f"/runs/{run_id}/events")).json()
    assert [e["edge_run_number"] for e in stored] == [1, 2, 3, 4, 5]
    assert stored[1]["to_node"] == ["branch_a", "branch_b"]

    stats = (await admin_client.get(f"/projects/{project_id}/stats")).json()
    split = next(n for n in stats["slowestNodes"] if n["nodeName"] == "split")
    assert split["totalDurationUs"] == 100_000


async def test_failed_run_stores_error_and_failednode(admin_client: AsyncClient):
    project_id, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    error = "ValueError: model returned no intent\nTraceback (most recent call last): ..."
    events = [
        edge("edge_start", 1, "START", "classify"),
        # Failed inside the gate: no destination chosen, and the node's time is unknown.
        edge("edge_route", 2, "classify", "N/A", edge_type="__conditional__", node_elapsed=None),
        run_end("FAILED", elapsed_time=0.7, error=error, failed_node="classify"),
    ]
    await ingest(admin_client, secret, batch(run_id, events))

    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "failed"
    assert run["error"] == error
    assert run["failedNode"] == "classify"
    assert run["nodeCount"] == 2  # "N/A" isn't a node
    stats = (await admin_client.get(f"/projects/{project_id}/stats")).json()
    assert stats["byOutcome"]["failed"] == 1
    assert {n["nodeName"] for n in stats["slowestNodes"]} == {"START"}  # classify had no node_elapsed


async def test_run_end_without_sdk_times_falls_back_to_server_clock(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    await ingest(admin_client, secret, batch(run_id, [{"kind": "run_end", "status": "FINISHED"}]))
    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "finished"
    assert run["elapsedUs"] >= 0


# --- lifecycle across batches ----------------------------------------------------------


async def test_empty_first_batch_shows_running_with_nodes(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    await ingest(admin_client, secret, batch(run_id, [], nodes=NODES, description="first"))

    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "running"
    assert len(run["graphNodes"]) == 4

    # A later batch's node list / description doesn't replace the first one.
    await ingest(admin_client, secret, batch(run_id, [edge("e", 1, "START", "END")], nodes=[node("other")], description="second"))
    live = (await admin_client.get(f"/runs/{run_id}/events")).json()
    assert [e["edge_id"] for e in live] == ["e"]

    await ingest(admin_client, secret, batch(run_id, [run_end()]))
    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "finished"
    assert len(run["graphNodes"]) == 4
    assert run["graphDescription"] == "first"


async def test_lost_first_batch_still_finalizes_without_nodes(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    # The batch carrying `nodes` never arrived: only edges and run_end did.
    await ingest(admin_client, secret, batch(run_id, happy_path_events()))
    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "finished"
    assert run["graphNodes"] is None
    assert run["nodeCount"] == 4


async def test_nodes_from_a_later_batch_are_kept_if_first_had_none(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    await ingest(admin_client, secret, batch(run_id, [edge("e1", 1, "START", "classify")]))
    await ingest(admin_client, secret, batch(run_id, [edge("e2", 2, "classify", "END")], nodes=NODES))
    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert len(run["graphNodes"]) == 4


async def test_live_buffer_is_ordered_by_edge_run_number(admin_client: AsyncClient):
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    await ingest(admin_client, secret, batch(run_id, [edge("b", 3, "x", "y"), edge("a", 1, "START", "x")]))
    await ingest(admin_client, secret, batch(run_id, [edge("c", 2, "x", "x")]))
    live = (await admin_client.get(f"/runs/{run_id}/events")).json()
    assert [e["edge_run_number"] for e in live] == [1, 2, 3]


async def test_events_after_run_end_are_rejected_not_silently_applied(admin_client: AsyncClient):
    """Regression test: a late run_end used to re-run _finalize against an empty buffer,
    overwriting a correctly-finalized run's stats. Now any batch after run_end gets 409."""
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    await ingest(admin_client, secret, batch(run_id, happy_path_events()))
    original = (await admin_client.get(f"/runs/{run_id}")).json()

    await ingest(admin_client, secret, batch(run_id, [run_end("FAILED", error="oops")]), expect=409)
    assert (await admin_client.get(f"/runs/{run_id}")).json() == original


async def test_run_id_from_another_project_is_rejected(admin_client: AsyncClient):
    _, secret_a = await project_and_ingest_secret(admin_client)
    project_b = (await admin_client.post("/projects", json={"name": "other", "env": "local"})).json()
    secret_b = (await admin_client.post(f"/projects/{project_b['id']}/keys", json={"label": "k", "scope": "ingest"})).json()["secret"]
    run_id = str(uuid.uuid4())
    await ingest(admin_client, secret_a, batch(run_id, [edge("e", 1, "a", "b")]))
    await ingest(admin_client, secret_b, batch(run_id, [run_end()]), expect=409)


# --- forward compatibility -------------------------------------------------------------


async def test_unknown_event_kind_does_not_break_thebatch(admin_client: AsyncClient):
    """A new event kind is a contract MINOR bump: stored and forwarded, not counted."""
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    events = [
        edge("e1", 1, "START", "a"),
        {"kind": "edge_start", "edge_id": "e2", "memory_mb": 128},
        edge("e2", 2, "a", "END"),
        run_end(),
    ]
    await ingest(admin_client, secret, batch(run_id, events))

    run = (await admin_client.get(f"/runs/{run_id}")).json()
    assert run["status"] == "finished"
    assert run["edgeCount"] == 2

    stored = (await admin_client.get(f"/runs/{run_id}/events")).json()
    assert [e["kind"] for e in stored] == ["edge", "edge_start", "edge"]
    assert stored[1]["memory_mb"] == 128


async def test_extra_and_truncated_fields_survive(admin_client: AsyncClient):
    """orkes may add fields (MINOR bump) and replace big ones with a truncation marker."""
    _, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    truncated = {"_truncated": True, "size": 400_000}
    new_edge = edge("e1", 1, "a", "b", edge_type="__brand_new__", retry_count=3, state_snapshot=truncated, llm_traces=truncated)
    await ingest(admin_client, secret, batch(run_id, [new_edge, run_end()]))

    stored = (await admin_client.get(f"/runs/{run_id}/events")).json()
    assert stored[0]["retry_count"] == 3
    assert stored[0]["edge_type"] == "__brand_new__"
    assert stored[0]["state_snapshot"] == truncated
    assert stored[0]["llm_traces"] == truncated


# --- abandoned runs --------------------------------------------------------------------


async def test_stale_running_run_is_marked_abandoned(admin_client: AsyncClient):
    project_id, secret = await project_and_ingest_secret(admin_client)
    stale_id, fresh_id = str(uuid.uuid4()), str(uuid.uuid4())
    await ingest(admin_client, secret, batch(stale_id, [edge("e1", 1, "START", "classify"), edge("e1", 2, "classify", "classify")], nodes=NODES))

    # Default timeout is 30 minutes: 29 minutes later, nothing happens yet.
    now = datetime.now(timezone.utc)
    assert await abandon_service.sweep_abandoned(now + timedelta(minutes=29)) == 0

    await ingest(admin_client, secret, batch(fresh_id, []))
    # Pretend the fresh run just sent something at +31 min: only the stale run is abandoned.
    import app.config.db as db_module
    from app.repositories import run_repository

    async with db_module.SessionLocal() as db:
        fresh = await run_repository.get(db, uuid.UUID(fresh_id))
        fresh.last_event_at = now + timedelta(minutes=31)
        await db.commit()

    assert await abandon_service.sweep_abandoned(now + timedelta(minutes=31)) == 1

    run = (await admin_client.get(f"/runs/{stale_id}")).json()
    assert run["status"] == "failed"
    assert run["error"] == "abandoned: no run_end received"
    assert run["loopCount"] == 1  # stats still computed from what did arrive
    stored = (await admin_client.get(f"/runs/{stale_id}/events")).json()
    assert len(stored) == 2  # failed runs are always flushed to the blob

    assert (await admin_client.get(f"/runs/{fresh_id}")).json()["status"] == "running"

    # A run_end that turns up after the run was abandoned is rejected.
    await ingest(admin_client, secret, batch(stale_id, [run_end()]), expect=409)


async def test_abandon_timeout_is_per_project(admin_client: AsyncClient):
    project_id, secret = await project_and_ingest_secret(admin_client)
    r = await admin_client.patch(f"/projects/{project_id}", json={"abandonAfterMinutes": 120})
    assert r.status_code == 200 and r.json()["abandonAfterMinutes"] == 120

    run_id = str(uuid.uuid4())
    await ingest(admin_client, secret, batch(run_id, []))
    now = datetime.now(timezone.utc)
    assert await abandon_service.sweep_abandoned(now + timedelta(minutes=60)) == 0
    assert await abandon_service.sweep_abandoned(now + timedelta(minutes=121)) == 1


# --- query access ----------------------------------------------------------------------


async def test_runs_list_pagination(admin_client: AsyncClient):
    project_id, secret = await project_and_ingest_secret(admin_client)
    for _ in range(3):
        await ingest(admin_client, secret, batch(str(uuid.uuid4()), happy_path_events()))

    page1 = (await admin_client.get(f"/projects/{project_id}/runs?limit=2&offset=0")).json()
    assert len(page1) == 2
    page2 = (await admin_client.get(f"/projects/{project_id}/runs?limit=2&offset=2")).json()
    assert len(page2) == 1
    assert {run["id"] for run in page1}.isdisjoint({run["id"] for run in page2})

    r = await admin_client.get(f"/projects/{project_id}/runs?limit=501")
    assert r.status_code == 422


async def test_run_not_visible_to_non_member(admin_client: AsyncClient, login_as):
    project_id, secret = await project_and_ingest_secret(admin_client)
    run_id = str(uuid.uuid4())
    await ingest(admin_client, secret, batch(run_id, happy_path_events()))

    outsider = await login_as("outsider@test.local", "developer")
    assert (await outsider.get(f"/runs/{run_id}")).status_code == 403
    assert (await outsider.get(f"/projects/{project_id}/stats")).status_code == 403
