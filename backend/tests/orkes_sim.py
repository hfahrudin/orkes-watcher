"""A stand-in for orkes's WatcherSink, used to test the watcher the way a real orkes run
will drive it (working_context/INTEGRATION_AGREEMENT.md §1.1, §2.2).

orkes calls the sink at three points: on_run_start (node list known, no edges yet),
on_edge (after each EdgeTrace is appended — so a parallel edge's branches come before
the parent), and on_run_end. The sink batches events per run and sends a batch when it
has `flush_every` events queued; the real sink also sends every 0.5 s, which tests stand
in for by calling `flush()`.

The sink doesn't send anything itself: each hook returns the request body that should be
POSTed now (or None), so the same sink works from async httpx tests and from Starlette's
sync TestClient (needed for WebSockets).

Graph scenarios come from scripts/seed_example_traces.py, which records edges in the same
order orkes appends them.
"""

import uuid
from collections.abc import Callable, Iterator

from app.config.version import LATEST_CONTRACT
from scripts import seed_example_traces as scenarios

SDK = {"name": "orkes", "version": "0.1.4"}
SCENARIOS: dict[str, Callable[[float], list[dict]]] = {
    "parallel": scenarios.happy_path_with_parallel_branch,
    "retry_loop": scenarios.retry_loop_that_escalates,
    "crash": scenarios.crash_in_routing_gate,
    "simple": scenarios.quick_simple_success,
}


class FakeWatcherSink:
    def __init__(self, graph_name: str = "support-triage", flush_every: int = 50, run_id: str | None = None):
        self.run_id = run_id or str(uuid.uuid4())
        self.graph_name = graph_name
        self.flush_every = flush_every
        self._queue: list[dict] = []
        self._ended = False

    def _envelope(self, events: list[dict], **extra) -> dict:
        return {"contract_version": LATEST_CONTRACT, "sdk": SDK, "run_id": self.run_id, "graph_name": self.graph_name, "events": events, **extra}

    def on_run_start(self, nodes: list[dict], description: str | None = None) -> dict:
        """First batch: the graph's node list, no events. Sent right away."""
        return self._envelope([], nodes=nodes, graph_description=description)

    def on_edge(self, edge: dict) -> dict | None:
        assert not self._ended, "orkes never calls on_edge after on_run_end"
        self._queue.append(edge)
        return self.flush() if len(self._queue) >= self.flush_every else None

    def flush(self) -> dict | None:
        """What the sink's 0.5 s timer does: send whatever is queued, if anything."""
        if not self._queue:
            return None
        events, self._queue = self._queue, []
        return self._envelope(events)

    def on_run_end(self, run_end: dict) -> dict:
        """Last batch: anything still queued, then exactly one run_end."""
        self._ended = True
        events, self._queue = [*self._queue, run_end], []
        return self._envelope(events)


def scenario(name: str, start_time: float = 1_790_000_000.0) -> tuple[list[dict], dict]:
    """(edges in orkes append order, run_end) for one of SCENARIOS."""
    *edges, end = SCENARIOS[name](start_time)
    return edges, end


def stream(sink: FakeWatcherSink, edges: list[dict], run_end: dict | None, *, nodes: list[dict] | None = None) -> Iterator[dict]:
    """Every request body the sink would send for a run, in order. Pass run_end=None to
    stop mid-run (a crashed process); pass nodes=None to skip the first batch."""
    if nodes is not None:
        yield sink.on_run_start(nodes, "Classifies a support ticket and answers or escalates it.")
    for edge in edges:
        body = sink.on_edge(edge)
        if body:
            yield body
    if run_end is not None:
        yield sink.on_run_end(run_end)
    else:
        tail = sink.flush()
        if tail:
            yield tail


graph_nodes = scenarios.graph_nodes
