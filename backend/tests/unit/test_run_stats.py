"""compute_run_stats / order_events / edge_endpoints: how orkes edge events become run and
node stats (docs/contracts/contract-1.0.md §2.5, §3)."""

from app.services.run_stats import compute_run_stats, edge_endpoints, order_events


def edge(edge_id: str, n: int, from_node: str, to_node, node_elapsed: float | None = 0.1) -> dict:
    return {"kind": "edge", "edge_id": edge_id, "edge_run_number": n, "from_node": from_node, "to_node": to_node, "elapsed": 1.0, "node_elapsed": node_elapsed}


# --- edge_endpoints ---------------------------------------------------------------------


def test_endpoints_of_forward_edge():
    assert edge_endpoints(edge("e", 1, "a", "b")) == ["a", "b"]


def test_endpoints_of_parallel_edge_include_every_branch():
    assert edge_endpoints(edge("e", 1, "split", ["x", "y", "z"])) == ["split", "x", "y", "z"]


def test_na_destination_is_not_a_node():
    assert edge_endpoints(edge("e", 1, "classify", "N/A")) == ["classify"]


def test_non_string_destinations_are_ignored():
    assert edge_endpoints(edge("e", 1, "a", None)) == ["a"]
    assert edge_endpoints(edge("e", 1, "a", ["b", 7, None])) == ["a", "b"]


# --- compute_run_stats ------------------------------------------------------------------


def test_empty_run():
    stats = compute_run_stats([])
    assert (stats.node_count, stats.edge_count, stats.loop_count) == (0, 0, 0)
    assert stats.node_durations == []


def test_linear_run():
    stats = compute_run_stats([edge("e1", 1, "START", "a"), edge("e2", 2, "a", "END")])
    assert stats.node_count == 3
    assert stats.edge_count == 2
    assert stats.loop_count == 0
    assert stats.visited_nodes == {"START", "a", "END"}


def test_loops_are_repeat_traversals_of_the_same_edge_id():
    events = [edge("e1", 1, "START", "a"), edge("retry", 2, "a", "a"), edge("retry", 3, "a", "a"), edge("retry", 4, "a", "END")]
    stats = compute_run_stats(events)
    assert stats.edge_count == 4  # traversals, not distinct edges
    assert stats.loop_count == 2


def test_reentering_a_node_through_a_different_edge_is_not_a_loop():
    """Accepted v1 limitation (contract §3)."""
    events = [edge("e1", 1, "a", "b"), edge("e2", 2, "b", "a"), edge("e3", 3, "a", "END")]
    assert compute_run_stats(events).loop_count == 0


def test_passes_left_is_not_a_loop_signal():
    events = [{**edge("e1", 1, "a", "b"), "passes_left": 24}]
    assert compute_run_stats(events).loop_count == 0


def test_node_durations_use_node_elapsed_not_edge_elapsed():
    """A parallel edge's `elapsed` includes its branches; node time must not (decision D3)."""
    parallel = {**edge("p", 1, "split", ["a", "b"], node_elapsed=0.1), "elapsed": 5.1}
    stats = compute_run_stats([parallel])
    assert stats.node_durations == [{"node_name": "split", "duration_us": 100_000}]


def test_edges_without_node_elapsed_get_no_duration():
    events = [edge("e1", 1, "a", "b", node_elapsed=None), {**edge("e2", 2, "b", "c"), "node_elapsed": {"_truncated": True}}]
    stats = compute_run_stats(events)
    assert stats.node_durations == []
    assert stats.node_count == 3  # still counted as visited


def test_one_duration_entry_per_visit():
    events = [edge("retry", 1, "a", "a", node_elapsed=0.2), edge("retry", 2, "a", "END", node_elapsed=0.3)]
    durations = compute_run_stats(events).node_durations
    assert [d["duration_us"] for d in durations] == [200_000, 300_000]


def test_integer_node_elapsed_is_accepted():
    assert compute_run_stats([edge("e", 1, "a", "b", node_elapsed=2)]).node_durations[0]["duration_us"] == 2_000_000


def test_unknown_event_kinds_are_not_counted():
    events = [edge("e1", 1, "a", "b"), {"kind": "edge_start", "edge_id": "e2"}]
    stats = compute_run_stats(events)
    assert stats.edge_count == 1
    assert stats.node_count == 2


# --- order_events -----------------------------------------------------------------------


def test_orders_edges_by_run_number():
    events = [edge("b", 3, "x", "y"), edge("a", 1, "START", "x"), edge("c", 2, "x", "x")]
    assert [e["edge_run_number"] for e in order_events(events)] == [1, 2, 3]


def test_parallel_parent_arriving_after_branches_moves_before_them():
    branch_a, branch_b, parent = edge("ba", 3, "a", "m"), edge("bb", 4, "b", "m"), edge("p", 2, "split", ["a", "b"])
    assert order_events([branch_a, branch_b, parent]) == [parent, branch_a, branch_b]


def test_unknown_events_keep_their_position():
    unknown = {"kind": "checkpoint"}
    events = [edge("b", 2, "x", "y"), unknown, edge("a", 1, "START", "x")]
    ordered = order_events(events)
    assert ordered[1] is unknown
    assert [e["edge_run_number"] for e in (ordered[0], ordered[2])] == [1, 2]


def test_gaps_in_run_numbers_are_fine():
    """Lost batches leave gaps; ordering must not assume consecutive numbers."""
    events = [edge("c", 9, "x", "y"), edge("a", 1, "START", "x")]
    assert [e["edge_run_number"] for e in order_events(events)] == [1, 9]


def test_order_events_does_not_mutate_its_input():
    events = [edge("b", 2, "x", "y"), edge("a", 1, "START", "x")]
    order_events(events)
    assert [e["edge_run_number"] for e in events] == [2, 1]
