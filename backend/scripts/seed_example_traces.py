"""Populates a `support-triage` example project with a handful of realistic traces, by
calling the real `POST /ingest/events` HTTP endpoint exactly as a real SDK would — not by
writing to Postgres/MinIO directly.

There's no real SDK yet (it's meant to live in its own repo, per ARCHITECTURE.md), so this
is the stand-in for one: it's the only thing in this codebase that currently exercises the
ingest contract from the outside, as an actual HTTP client. Treat it as a live reference
implementation of working_context/TRACES_CONTRACT.md, not just a demo-data generator — if
this script and the contract doc ever disagree, the contract doc is probably stale.

Requires the backend to actually be running and reachable (unlike retention.py /
sweep_orphan_blobs.py, which only need Postgres/MinIO).

Usage:
  uv run python -m scripts.seed_example_traces
  docker compose exec backend python -m scripts.seed_example_traces
"""

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from app.config.settings import settings
from app.config.db import SessionLocal
from app.repositories import project_repository, user_repository
from app.services import api_key_service, project_service

BACKEND_URL = os.environ.get("ORKES_SEED_BACKEND_URL", "http://localhost:8000")
PROJECT_NAME = "support-triage"

NODE_NAMES = {
    "START": "Start",
    "classify": "Classify intent",
    "retrieve": "Retrieve context",
    "tool_search": "Search docs",
    "tool_faq": "Search FAQ",
    "merge": "Merge results",
    "answer": "Draft answer",
    "escalate": "Escalate to human",
    "END": "End",
}


def _iso(base: datetime, offset_ms: float) -> str:
    return (base + timedelta(milliseconds=offset_ms)).isoformat().replace("+00:00", "Z")


def _node(node_id: str, seq: int, visit_index: int, entered_ms: float, exited_ms: float | None, base: datetime) -> dict:
    return {
        "kind": "node",
        "nodeId": node_id,
        "nodeName": NODE_NAMES[node_id],
        "seq": seq,
        "visitIndex": visit_index,
        "enteredAt": _iso(base, entered_ms),
        "exitedAt": _iso(base, exited_ms) if exited_ms is not None else None,
    }


def _edge(
    edge_id: str,
    from_node: str,
    to_node: str,
    edge_type: str,
    run_seq: int,
    elapsed_us: int,
    state_snapshot: dict,
    fn_calls: list[dict] | None = None,
    passes_left: int | None = None,
) -> dict:
    return {
        "kind": "edge",
        "edgeId": edge_id,
        "fromNode": from_node,
        "toNode": to_node,
        "edgeType": edge_type,
        "runSeq": run_seq,
        "passesLeft": passes_left,
        "elapsedUs": elapsed_us,
        "stateSnapshot": state_snapshot,
        "fnCalls": fn_calls or [],
    }


def happy_path_with_parallel_branch(base: datetime) -> list[dict]:
    """START -> classify -> retrieve -> [tool_search, tool_faq] -> merge -> answer -> END."""
    return [
        _node("START", 0, 1, 0, 5, base),
        _edge("e1", "START", "classify", "forward", 1, 5_000, {"input": "How do I reset my API key?"}),
        _node("classify", 2, 1, 5, 180, base),
        _edge(
            "e2", "classify", "retrieve", "conditional", 3, 175_000, {"intent": "account_settings", "needsLookup": True},
            [{"name": "classify_intent", "args": {"text": "How do I reset my API key?"}, "returns": {"intent": "account_settings", "confidence": 0.97}, "durationUs": 175_000}],
        ),
        _node("retrieve", 4, 1, 180, 820, base),
        _edge("e3", "retrieve", "tool_search", "parallel", 5, 640_000, {"intent": "account_settings"}),
        _edge("e4", "retrieve", "tool_faq", "parallel", 5, 640_000, {"intent": "account_settings"}),
        _node("tool_search", 6, 1, 820, 1400, base),
        _node("tool_faq", 6, 1, 820, 1120, base),
        _edge("e5", "tool_search", "merge", "forward", 7, 580_000, {"docs": ["api-keys.md"]}, [{"name": "search_docs", "args": {"query": "reset api key"}, "returns": {"docs": ["api-keys.md"]}, "durationUs": 580_000}]),
        _edge("e6", "tool_faq", "merge", "forward", 7, 300_000, {"faq": ["How to rotate an API key"]}, [{"name": "search_faq", "args": {"query": "reset api key"}, "returns": {"faq": ["How to rotate an API key"]}, "durationUs": 300_000}]),
        _node("merge", 8, 1, 1400, 1480, base),
        _edge("e7", "merge", "answer", "conditional", 9, 80_000, {"confidence": 0.94}),
        _node("answer", 10, 1, 1480, 2100, base),
        _edge(
            "e8", "answer", "END", "forward", 11, 620_000,
            {"answer": "Go to Settings > API keys, revoke the old key, and generate a new one."},
            [{"name": "draft_answer", "args": {}, "returns": {"chars": 78}, "durationUs": 620_000}],
        ),
        _node("END", 12, 1, 2100, 2100, base),
        {"kind": "run_end", "status": "finished"},
    ]


def retry_loop_that_escalates(base: datetime) -> list[dict]:
    """classify <-> retrieve loops twice on low confidence, then escalates to a human."""
    return [
        _node("START", 0, 1, 0, 4, base),
        _edge("e1", "START", "classify", "forward", 1, 4_000, {"input": "my billing is wrong and also the app crashed twice"}),
        _node("classify", 2, 1, 4, 210, base),
        _edge("e2", "classify", "retrieve", "conditional", 3, 206_000, {"intent": "billing", "needsLookup": True}),
        _node("retrieve", 4, 1, 210, 900, base),
        _edge("e3", "retrieve", "classify", "forward", 5, 690_000, {"intent": "billing", "confidence": 0.31}, passes_left=2),
        _node("classify", 6, 2, 900, 1050, base),
        _edge("e4", "classify", "retrieve", "conditional", 7, 150_000, {"intent": "billing_dispute", "needsLookup": True}),
        _node("retrieve", 8, 2, 1050, 1700, base),
        _edge("e5", "retrieve", "classify", "forward", 9, 650_000, {"intent": "billing_dispute", "confidence": 0.28}, passes_left=1),
        _node("classify", 10, 3, 1700, 1850, base),
        _edge("e6", "classify", "escalate", "conditional", 11, 150_000, {"intent": "billing_dispute", "confidence": 0.28, "reason": "low_confidence_after_retries"}),
        _node("escalate", 12, 1, 1850, 1900, base),
        _edge("e7", "escalate", "END", "forward", 13, 50_000, {"escalatedTo": "human_queue"}),
        _node("END", 14, 1, 1900, 1900, base),
        {"kind": "run_end", "status": "failed", "error": "escalated: low_confidence_after_retries"},
    ]


def quick_simple_success(base: datetime) -> list[dict]:
    """The smallest realistic trace: no branches, no loops, no tool calls."""
    return [
        _node("START", 0, 1, 0, 2, base),
        _edge("e1", "START", "classify", "forward", 1, 2_000, {"input": "hi"}),
        _node("classify", 2, 1, 2, 45, base),
        _edge("e2", "classify", "answer", "conditional", 3, 43_000, {"intent": "greeting", "confidence": 0.99}),
        _node("answer", 4, 1, 45, 90, base),
        _edge("e3", "answer", "END", "forward", 5, 45_000, {"answer": "Hey! How can I help today?"}),
        _node("END", 6, 1, 90, 90, base),
        {"kind": "run_end", "status": "finished"},
    ]


async def ensure_project_and_key() -> tuple[str, str]:
    async with SessionLocal() as db:
        admin = await user_repository.get_by_email(db, settings.bootstrap_admin_email)
        if admin is None:
            raise SystemExit(f"No user {settings.bootstrap_admin_email!r} found — has the backend started at least once to bootstrap it?")

        existing = [p for p in await project_repository.list_for_user(db, user_id=admin.id, is_admin=True) if p.name == PROJECT_NAME]
        if existing:
            project = existing[0]
            print(f"reusing existing project {PROJECT_NAME} ({project.id})")
        else:
            project, _first_key_secret = await project_service.create_project(db, name=PROJECT_NAME, env="production", creator=admin)
            await db.commit()
            print(f"created project {PROJECT_NAME} ({project.id})")

        _key, secret = await api_key_service.create_key(db, project_id=project.id, label="seed script", scope="ingest", created_by=admin.id)
        await db.commit()
        return str(project.id), secret


async def main() -> None:
    project_id, secret = await ensure_project_and_key()

    scenarios = [
        ("happy path with a parallel branch", happy_path_with_parallel_branch, timedelta(minutes=5)),
        ("retry loop that escalates", retry_loop_that_escalates, timedelta(minutes=12)),
        ("quick simple success", quick_simple_success, timedelta(minutes=1)),
    ]

    async with httpx.AsyncClient(base_url=BACKEND_URL, timeout=10) as client:
        for label, builder, ago in scenarios:
            run_id = str(uuid.uuid4())
            base = datetime.now(timezone.utc) - ago
            events = builder(base)
            r = await client.post("/ingest/events", headers={"Authorization": f"Bearer {secret}"}, json={"runId": run_id, "graphName": PROJECT_NAME, "events": events})
            r.raise_for_status()
            print(f"  seeded: {label} -> run {run_id}")

    print(f"done — project_id={project_id}")


if __name__ == "__main__":
    asyncio.run(main())
