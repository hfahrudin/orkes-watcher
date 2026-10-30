"""Populates a `support-triage` example project with a few realistic traces, by calling the
real `POST /ingest/events` HTTP endpoint exactly as orkes's WatcherSink would — not by
writing to Postgres/MinIO directly.

Payloads follow the orkes trace contract 1.0 (docs/contracts/contract-1.0.md §2):
snake_case, times in seconds, orkes's own edge types and status strings. Each run is sent
the way the sink sends it: a first batch with the graph's node list and no events, then the
edges, then a last batch ending in run_end. Treat this as a live reference client for the
contract: if the two ever disagree, fix whichever is wrong and update the agreement.

Requires the backend to be running and reachable (unlike retention.py /
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

from app.config.db import SessionLocal
from app.config.settings import settings
from app.config.version import LATEST_CONTRACT
from app.repositories import project_repository, user_repository
from app.services import api_key_service, project_service

BACKEND_URL = os.environ.get("ORKES_SEED_BACKEND_URL", "http://localhost:8000")
PROJECT_NAME = "support-triage"
SDK = {"name": "orkes", "version": "0.1.4"}

NODE_DOCS = {
    "START": None,
    "classify": "Classify the ticket's intent.",
    "retrieve": "Look up context for the ticket.",
    "tool_search": "Search the product docs.",
    "tool_faq": "Search the FAQ.",
    "merge": "Merge results from both searches.",
    "answer": "Draft an answer for the customer.",
    "escalate": "Hand the ticket to a human.",
    "END": None,
}
NODE_TYPES = {"START": "start_node", "END": "end_node", "merge": "aggregation_node"}


def graph_nodes() -> list[dict]:
    """The graph's node list, as orkes sends it in a run's first batch."""
    return [
        {"node_id": f"node_{uuid.uuid4()}", "node_name": name, "node_description": doc, "meta": {"type": NODE_TYPES.get(name, "function_node")}}
        for name, doc in NODE_DOCS.items()
    ]


class RunBuilder:
    """Builds edge events the way orkes's runner records them: one EdgeTrace per
    traversal, numbered from 1, timed from the start of the source node."""

    def __init__(self, start_time: float, max_passes: int = 25):
        self.start_time = start_time
        self.clock = start_time
        self.max_passes = max_passes
        self.events: list[dict] = []
        self._run_number = 0
        self._edge_ids: dict[tuple[str, str], str] = {}
        self._passes: dict[str, int] = {}

    def _next_run_number(self) -> int:
        self._run_number += 1
        return self._run_number

    def edge(
        self,
        from_node: str,
        to_node: str | list[str],
        edge_type: str,
        node_elapsed: float | None,
        state: dict,
        *,
        extra_elapsed: float = 0.0,
        meta: dict | None = None,
        function_traces: list[dict] | None = None,
        llm_traces: list[dict] | None = None,
        run_number: int | None = None,
        started_at: float | None = None,
        elapsed: float | None = None,
    ) -> dict:
        # orkes reuses one edge_id per structural edge: a conditional edge keeps its id
        # whichever branch it takes, so key on (from_node, edge_type).
        edge_id = self._edge_ids.setdefault((from_node, edge_type), f"edge_{uuid.uuid4()}")
        self._passes[edge_id] = self._passes.get(edge_id, 0) + 1
        if elapsed is None:
            elapsed = (node_elapsed or 0.0) + extra_elapsed
        event = {
            "kind": "edge",
            "edge_id": edge_id,
            "edge_run_number": run_number or self._next_run_number(),
            "from_node": from_node,
            "to_node": to_node,
            "passes_left": self.max_passes - self._passes[edge_id],
            "edge_type": edge_type,
            "started_at": self.clock if started_at is None else started_at,
            "elapsed": elapsed,
            "node_elapsed": node_elapsed,
            "state_snapshot": state,
            "meta": meta or {},
            "function_traces": function_traces or [],
            "llm_traces": llm_traces or [],
        }
        self.events.append(event)
        if started_at is None:
            self.clock += elapsed
        return event

    def parallel(self, from_node: str, node_elapsed: float, state: dict, aggregation_node: str, branches) -> None:
        """orkes runs every branch inside the parallel edge's timer. The parent edge gets
        the lower run number (it's traversed first) but is appended to the trace after its
        branches, so it arrives last. `branches` is a callable that records the branch edges."""
        started_at, run_number = self.clock, self._next_run_number()
        self.clock += node_elapsed
        branches()
        targets = [e["from_node"] for e in self.events if e["edge_run_number"] > run_number]
        self.edge(
            from_node, targets, "__parallel__", node_elapsed, state,
            meta={"type": "parallel_edge", "aggregation_node": aggregation_node},
            run_number=run_number, started_at=started_at, elapsed=self.clock - started_at,
        )

    def run_end(self, status: str, final_state: dict, error: str | None = None, failed_node: str | None = None) -> dict:
        """final_state: the run's output (FINISHED) or the state when it failed (FAILED)."""
        return {
            "kind": "run_end",
            "status": status,
            "start_time": self.start_time,
            "elapsed_time": self.clock - self.start_time,
            "error": error,
            "failed_node": failed_node,
            "final_state": final_state,
        }


def _fn(name: str, kwargs: dict, returns, elapsed: float) -> dict:
    return {"function_name": name, "input_args": [], "input_kwargs": kwargs, "return_value": returns, "elapsed": elapsed}


def _llm(system: str, user: str, reply: str) -> dict:
    return {
        "messages": {"messages": [{"role": "system", "content": system, "content_type": None, "tool_call_id": None}, {"role": "user", "content": user, "content_type": None, "tool_call_id": None}]},
        "tools": None,
        "parsed_response": {"content_type": "message", "content": reply},
        "model": "gpt-4o-mini",
        "settings": {"temperature": 0.2},
    }


def happy_path_with_parallel_branch(start: float) -> list[dict]:
    """START -> classify -> retrieve -> [tool_search, tool_faq] -> merge -> answer -> END."""
    question = "How do I reset my API key?"
    b = RunBuilder(start)
    b.edge("START", "classify", "__forward__", 0.001, {"input": question})
    b.edge(
        "classify", "retrieve", "__conditional__", 0.17, {"input": question, "intent": ""}, extra_elapsed=0.005,
        function_traces=[_fn("classify_intent", {"text": question}, {"intent": "account_settings", "confidence": 0.97}, 0.17)],
        llm_traces=[_llm("Classify the support ticket's intent.", question, "account_settings")],
    )
    b.parallel(
        "retrieve", 0.04, {"intent": "account_settings", "needs_lookup": True}, "merge",
        lambda: (
            b.edge(
                "tool_search", "merge", "__forward__", 0.58, {"intent": "account_settings"},
                function_traces=[_fn("search_docs", {"query": "reset api key"}, {"docs": ["api-keys.md"]}, 0.58)],
            ),
            b.edge(
                "tool_faq", "merge", "__forward__", 0.3, {"intent": "account_settings"},
                function_traces=[_fn("search_faq", {"query": "reset api key"}, {"faq": ["How to rotate an API key"]}, 0.3)],
            ),
        ),
    )
    b.edge("merge", "answer", "__forward__", 0.08, {"docs": ["api-keys.md"], "faq": ["How to rotate an API key"]})
    b.edge(
        "answer", "END", "__forward__", 0.62, {"confidence": 0.94},
        llm_traces=[_llm("Answer the customer using the context.", question, "Go to Settings > API keys, revoke the old key, and generate a new one.")],
    )
    final = {"confidence": 0.94, "answer": "Go to Settings > API keys, revoke the old key, and generate a new one."}
    return [*b.events, b.run_end("FINISHED", final)]


def retry_loop_that_escalates(start: float) -> list[dict]:
    """classify -> retrieve loops twice on low confidence, then escalates to a human."""
    ticket = "my billing is wrong and also the app crashed twice"
    b = RunBuilder(start)
    b.edge("START", "classify", "__forward__", 0.001, {"input": ticket, "attempt": 0})
    for attempt, confidence in ((1, 0.31), (2, 0.28)):
        b.edge("classify", "retrieve", "__conditional__", 0.2, {"input": ticket, "attempt": attempt}, extra_elapsed=0.004)
        b.edge("retrieve", "classify", "__forward__", 0.65, {"intent": "billing_dispute", "confidence": confidence, "attempt": attempt})
    b.edge("classify", "escalate", "__conditional__", 0.15, {"confidence": 0.28, "reason": "low_confidence_after_retries"}, extra_elapsed=0.004)
    b.edge("escalate", "END", "__forward__", 0.05, {"escalated_to": "human_queue"})
    return [*b.events, b.run_end("FINISHED", {"escalated_to": "human_queue", "ticket_id": "T-4821"})]


def crash_in_routing_gate(start: float) -> list[dict]:
    """The classifier returns no intent and the routing gate raises: no destination."""
    b = RunBuilder(start)
    b.edge("START", "classify", "__forward__", 0.001, {"input": "???"})
    b.edge("classify", "N/A", "__conditional__", 0.12, {"input": "???", "intent": None}, extra_elapsed=0.002)
    error = (
        "KeyError: 'intent'\n"
        "Traceback (most recent call last):\n"
        '  File "graph.py", line 41, in route\n'
        '    return ROUTES[state["intent"]]\n'
        "KeyError: 'intent'"
    )
    return [*b.events, b.run_end("FAILED", {"input": "???", "intent": None}, error=error, failed_node="classify")]


def quick_simple_success(start: float) -> list[dict]:
    """The smallest realistic trace: no branches, no loops, no tool calls."""
    b = RunBuilder(start)
    b.edge("START", "classify", "__forward__", 0.001, {"input": "hi"})
    b.edge("classify", "answer", "__conditional__", 0.043, {"input": "hi", "intent": "greeting"}, extra_elapsed=0.001)
    b.edge("answer", "END", "__forward__", 0.045, {"answer": "Hey! How can I help today?"})
    return [*b.events, b.run_end("FINISHED", {"input": "hi", "intent": "greeting", "answer": "Hey! How can I help today?"})]


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


def _envelope(run_id: str, events: list[dict], **extra) -> dict:
    return {"contract_version": LATEST_CONTRACT, "sdk": SDK, "run_id": run_id, "graph_name": PROJECT_NAME, "events": events, **extra}


async def send_run(client: httpx.AsyncClient, secret: str, events: list[dict]) -> str:
    run_id = str(uuid.uuid4())
    headers = {"Authorization": f"Bearer {secret}"}
    batches = [
        _envelope(run_id, [], nodes=graph_nodes(), graph_description="Classifies a support ticket and answers or escalates it."),
        _envelope(run_id, events[:-1]),
        _envelope(run_id, events[-1:]),  # run_end, last
    ]
    for body in batches:
        r = await client.post("/ingest/events", headers=headers, json=body)
        r.raise_for_status()
    return run_id


async def main() -> None:
    project_id, secret = await ensure_project_and_key()

    scenarios = [
        ("happy path with a parallel branch", happy_path_with_parallel_branch, timedelta(minutes=5)),
        ("retry loop that escalates", retry_loop_that_escalates, timedelta(minutes=12)),
        ("crash in the routing gate", crash_in_routing_gate, timedelta(minutes=8)),
        ("quick simple success", quick_simple_success, timedelta(minutes=1)),
    ]

    async with httpx.AsyncClient(base_url=BACKEND_URL, timeout=10) as client:
        for label, builder, ago in scenarios:
            start = (datetime.now(timezone.utc) - ago).timestamp()
            run_id = await send_run(client, secret, builder(start))
            print(f"  seeded: {label} -> run {run_id}")

    print(f"done — project_id={project_id}")


if __name__ == "__main__":
    asyncio.run(main())
