"""IngestBatch validation: what the orkes trace contract 1.0 accepts and rejects
(docs/contracts/contract-1.0.md §2.3–2.6), without going through HTTP."""

import uuid

import pytest
from pydantic import ValidationError

from app.schemas.trace_event import MAX_BATCH_EVENTS, EdgeEvent, IngestBatch, RunEndEvent, UnknownEvent


def envelope(events: list[dict], **overrides) -> dict:
    return {"contract_version": "1.0", "sdk": {"name": "orkes", "version": "0.1.4"}, "run_id": str(uuid.uuid4()), "graph_name": "g", "events": events, **overrides}


def edge(**overrides) -> dict:
    return {"kind": "edge", "edge_id": "edge_1", "edge_run_number": 1, "from_node": "a", "to_node": "b", "elapsed": 0.5, **overrides}


def test_minimal_batch_is_valid():
    batch = IngestBatch.model_validate(envelope([]))
    assert batch.events == []
    assert batch.nodes is None and batch.graph_description is None


def test_events_route_to_the_right_model():
    batch = IngestBatch.model_validate(envelope([edge(), {"kind": "edge_start", "x": 1}, {"kind": "run_end", "status": "FINISHED"}]))
    assert [type(e) for e in batch.events] == [EdgeEvent, UnknownEvent, RunEndEvent]


def test_to_node_accepts_string_or_list():
    batch = IngestBatch.model_validate(envelope([edge(to_node="b"), edge(to_node=["x", "y"])]))
    assert batch.events[1].to_node == ["x", "y"]


@pytest.mark.parametrize("field", ["edge_id", "edge_run_number", "from_node", "to_node", "elapsed"])
def test_backend_critical_edge_fields_are_required(field):
    bad = edge()
    del bad[field]
    with pytest.raises(ValidationError):
        IngestBatch.model_validate(envelope([bad]))


def test_optional_edge_fields_default_sensibly():
    e = IngestBatch.model_validate(envelope([edge()])).events[0]
    assert e.node_elapsed is None and e.started_at is None and e.passes_left is None and e.edge_type is None


def test_unknown_fields_are_kept_everywhere():
    batch = IngestBatch.model_validate(envelope([edge(retry_count=3)], nodes=[{"node_id": "n", "node_name": "a", "color": "red"}], sdk={"name": "orkes", "version": "1", "build": "abc"}))
    assert batch.events[0].model_dump()["retry_count"] == 3
    assert batch.nodes[0].model_dump()["color"] == "red"
    assert batch.sdk.model_dump()["build"] == "abc"


def test_truncation_markers_are_accepted_on_passthrough_fields():
    marker = {"_truncated": True, "size": 300_000}
    e = IngestBatch.model_validate(envelope([edge(state_snapshot=marker, llm_traces=marker, function_traces=marker, meta=marker)])).events[0]
    assert e.state_snapshot == marker and e.llm_traces == marker


def test_edge_type_is_an_open_set():
    assert IngestBatch.model_validate(envelope([edge(edge_type="__brand_new__")])).events[0].edge_type == "__brand_new__"


@pytest.mark.parametrize("status", ["FINISHED", "FAILED"])
def test_run_end_accepts_orkes_statuses(status):
    batch = IngestBatch.model_validate(envelope([{"kind": "run_end", "status": status}]))
    assert batch.events[0].status == status


@pytest.mark.parametrize(
    "extra, expected",
    [({}, None), ({"final_state": None}, None), ({"final_state": {"n": 2}}, {"n": 2}),
     ({"final_state": {"_truncated": True, "size": 300_000}}, {"_truncated": True, "size": 300_000})],
)
def test_run_end_final_state_is_optional_and_kept(extra, expected):
    batch = IngestBatch.model_validate(envelope([{"kind": "run_end", "status": "FINISHED", **extra}]))
    assert batch.events[0].final_state == expected


@pytest.mark.parametrize("status", ["finished", "SUCCESS", "running", ""])
def test_run_end_rejects_other_statuses(status):
    with pytest.raises(ValidationError):
        IngestBatch.model_validate(envelope([{"kind": "run_end", "status": status}]))


def test_run_end_must_be_last():
    with pytest.raises(ValidationError, match="last event"):
        IngestBatch.model_validate(envelope([{"kind": "run_end", "status": "FINISHED"}, edge()]))


def test_only_one_run_end_per_batch():
    with pytest.raises(ValidationError, match="at most one"):
        IngestBatch.model_validate(envelope([{"kind": "run_end", "status": "FINISHED"}, {"kind": "run_end", "status": "FAILED"}]))


@pytest.mark.parametrize("version", ["1", "v1.0", "1.0.0", "", None])
def test_contract_version_must_be_major_minor(version):
    with pytest.raises(ValidationError):
        IngestBatch.model_validate(envelope([], contract_version=version))


def test_sdk_is_required():
    body = envelope([])
    del body["sdk"]
    with pytest.raises(ValidationError):
        IngestBatch.model_validate(body)


def test_run_id_must_be_a_uuid():
    with pytest.raises(ValidationError):
        IngestBatch.model_validate(envelope([], run_id="run-123"))


def test_batch_size_limit():
    IngestBatch.model_validate(envelope([edge()] * MAX_BATCH_EVENTS))
    with pytest.raises(ValidationError):
        IngestBatch.model_validate(envelope([edge()] * (MAX_BATCH_EVENTS + 1)))
