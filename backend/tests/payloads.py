"""Builders for orkes trace contract 1.0 payloads, in exactly the shape orkes's
WatcherSink sends (working_context/INTEGRATION_AGREEMENT.md §2). Shared by the
integration and load tests."""

import uuid

from httpx import AsyncClient

START_TIME = 1_790_000_000.0  # Unix seconds, orkes's clock


async def project_and_ingest_secret(admin_client: AsyncClient) -> tuple[str, str]:
    project = (await admin_client.post("/projects", json={"name": "support-triage", "env": "production"})).json()
    key = (await admin_client.post(f"/projects/{project['id']}/keys", json={"label": "k", "scope": "ingest"})).json()
    return project["id"], key["secret"]


def auth(secret: str) -> dict:
    return {"Authorization": f"Bearer {secret}"}


def node(name: str, node_type: str = "function_node") -> dict:
    return {"node_id": f"node_{uuid.uuid4()}", "node_name": name, "node_description": f"{name} docstring", "meta": {"type": node_type}}


NODES = [node("START", "start_node"), node("classify"), node("answer"), node("END", "end_node")]


def edge(edge_id: str, run_number: int, from_node: str, to_node, *, edge_type: str = "__forward__", elapsed: float = 0.1, node_elapsed: float | None = 0.1, **extra) -> dict:
    return {
        "kind": "edge",
        "edge_id": edge_id,
        "edge_run_number": run_number,
        "from_node": from_node,
        "to_node": to_node,
        "passes_left": 24,
        "edge_type": edge_type,
        "started_at": START_TIME + run_number,
        "elapsed": elapsed,
        "node_elapsed": node_elapsed,
        "state_snapshot": {"step": run_number},
        "meta": {},
        "function_traces": [],
        "llm_traces": [],
        **extra,
    }


def run_end(status: str = "FINISHED", *, elapsed_time: float = 2.5, error: str | None = None, failed_node: str | None = None) -> dict:
    return {"kind": "run_end", "status": status, "start_time": START_TIME, "elapsed_time": elapsed_time, "error": error, "failed_node": failed_node}


def batch(run_id: str, events: list[dict], *, nodes: list[dict] | None = None, description: str | None = None, contract_version: str = "1.0") -> dict:
    body = {
        "contract_version": contract_version,
        "sdk": {"name": "orkes", "version": "0.1.4"},
        "run_id": run_id,
        "graph_name": "support-triage",
        "events": events,
    }
    if nodes is not None:
        body["nodes"] = nodes
    if description is not None:
        body["graph_description"] = description
    return body


def happy_path_events() -> list[dict]:
    return [
        edge("edge_a", 1, "START", "classify", node_elapsed=0.001),
        edge("edge_b", 2, "classify", "answer", edge_type="__conditional__", elapsed=0.4, node_elapsed=0.3),
        edge("edge_c", 3, "answer", "END", node_elapsed=0.6),
        run_end(),
    ]


async def ingest(client: AsyncClient, secret: str, body: dict, expect: int = 202):
    r = await client.post("/ingest/events", headers=auth(secret), json=body)
    assert r.status_code == expect, r.text
    return r
