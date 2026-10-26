"""The fake orkes sink must follow the contract itself, or the tests built on it prove
nothing (INTEGRATION_AGREEMENT.md §1.1, §2.2)."""

import pytest

from app.schemas.trace_event import IngestBatch, RunEndEvent
from tests.orkes_sim import SCENARIOS, FakeWatcherSink, graph_nodes, scenario, stream


@pytest.mark.parametrize("name", SCENARIOS)
def test_every_batch_is_valid_contract_payload(name):
    edges, end = scenario(name)
    for body in stream(FakeWatcherSink(flush_every=3), edges, end, nodes=graph_nodes()):
        IngestBatch.model_validate(body)


def test_first_batch_has_nodes_and_no_events():
    edges, end = scenario("simple")
    first = next(stream(FakeWatcherSink(), edges, end, nodes=graph_nodes()))
    assert first["events"] == []
    assert {n["node_name"] for n in first["nodes"]} >= {"START", "END"}


def test_batches_respect_flush_size_and_run_end_is_last():
    edges, end = scenario("parallel")
    bodies = list(stream(FakeWatcherSink(flush_every=2), edges, end, nodes=graph_nodes()))
    middle, last = bodies[1:-1], bodies[-1]
    assert all(len(b["events"]) == 2 for b in middle)
    assert last["events"][-1]["kind"] == "run_end"
    assert sum(len(b["events"]) for b in bodies) == len(edges) + 1


def test_all_batches_share_one_run_id():
    edges, end = scenario("retry_loop")
    assert len({b["run_id"] for b in stream(FakeWatcherSink(flush_every=1), edges, end, nodes=graph_nodes())}) == 1


def test_parallel_parent_is_sent_after_its_branches():
    """orkes appends the parent parallel edge after its branches, so it arrives later
    even though it has the lower edge_run_number."""
    edges, _ = scenario("parallel")
    sent = [e["edge_run_number"] for e in edges]
    parent = next(e for e in edges if e["edge_type"] == "__parallel__")
    assert sent.index(parent["edge_run_number"]) > sent.index(parent["edge_run_number"] + 1)
    assert sorted(sent) == list(range(1, len(edges) + 1))


def test_flush_sends_partial_batch_and_nothing_when_empty():
    sink = FakeWatcherSink(flush_every=50)
    edges, _ = scenario("simple")
    assert sink.on_edge(edges[0]) is None
    assert len(sink.flush()["events"]) == 1
    assert sink.flush() is None


def test_stopping_mid_run_sends_no_run_end():
    edges, _ = scenario("parallel")
    bodies = list(stream(FakeWatcherSink(flush_every=3), edges[:4], None, nodes=graph_nodes()))
    events = [e for b in bodies for e in b["events"]]
    assert len(events) == 4
    assert not any(isinstance(e, RunEndEvent) or e.get("kind") == "run_end" for e in events)


def test_no_edges_after_run_end():
    sink = FakeWatcherSink()
    edges, end = scenario("simple")
    sink.on_run_end(end)
    with pytest.raises(AssertionError):
        sink.on_edge(edges[0])
