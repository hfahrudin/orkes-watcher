"""Pure functions that turn a run's orkes edge events into the numbers stored on `runs` and
`run_node_stats`. No I/O, so they're unit-tested directly (tests/unit/test_run_stats.py).
Field meanings: docs/contracts/contract-1.0.md §2.5."""

from dataclasses import dataclass
from typing import Any

# orkes uses "N/A" as to_node when no destination was chosen (e.g. the run failed before a
# conditional's gate picked a branch). It's not a node.
NO_DESTINATION = "N/A"


@dataclass(frozen=True)
class RunStats:
    node_count: int
    edge_count: int
    loop_count: int
    visited_nodes: frozenset[str]
    # One entry per node visit that has a known duration: {"node_name", "duration_us"}.
    node_durations: list[dict[str, Any]]


def compute_run_stats(events: list[dict[str, Any]]) -> RunStats:
    edges = [e for e in events if e.get("kind") == "edge"]
    edge_ids = [e["edge_id"] for e in edges]
    visited = frozenset(name for e in edges for name in edge_endpoints(e))
    return RunStats(
        node_count=len(visited),
        edge_count=len(edges),  # traversals, not distinct edges
        # A loop = traversing an edge already traversed in this run. Re-entering a node
        # through a different edge isn't counted (accepted for v1, contract §3).
        loop_count=len(edge_ids) - len(set(edge_ids)),
        visited_nodes=visited,
        # node_elapsed is the source node's own run time, excluding gates and parallel
        # branches (decision D3). Edges without it (node never finished) are skipped.
        node_durations=[
            {"node_name": e["from_node"], "duration_us": int(e["node_elapsed"] * 1_000_000)}
            for e in edges
            if isinstance(e.get("node_elapsed"), (int, float))
        ],
    )


def edge_endpoints(edge: dict[str, Any]) -> list[str]:
    """Node names an edge touches: its source plus each real destination."""
    to_node = edge.get("to_node")
    targets = to_node if isinstance(to_node, list) else [to_node]
    return [edge["from_node"], *(t for t in targets if isinstance(t, str) and t != NO_DESTINATION)]


def order_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sorts edge events by edge_run_number (parallel branches arrive before their parent
    edge). Unknown event kinds keep their original positions."""
    edge_slots = [i for i, e in enumerate(events) if e.get("kind") == "edge"]
    ordered = sorted((events[i] for i in edge_slots), key=lambda e: e["edge_run_number"])
    result = list(events)
    for slot, edge in zip(edge_slots, ordered):
        result[slot] = edge
    return result
