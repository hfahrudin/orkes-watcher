import uuid
from datetime import datetime
from typing import Annotated, Any, Literal, Union

from pydantic import ConfigDict, Discriminator, Field, Tag

MAX_BATCH_EVENTS = 5000

from app.schemas.base import CamelModel

_KNOWN_KINDS = ("node", "edge", "run_end")


def _event_kind(v: Any) -> str:
    """Routes to UnknownEvent for any kind the backend doesn't recognize yet, instead of
    Pydantic's default discriminated-union behavior of rejecting the whole batch."""
    k = v.get("kind") if isinstance(v, dict) else getattr(v, "kind", None)
    return k if k in _KNOWN_KINDS else "unknown"


class PassthroughModel(CamelModel):
    """Fields beyond what's declared here ride along untouched (ingest -> buffer/blob ->
    query response) instead of being silently dropped. The backend's own logic only reads
    a handful of fields per event (see ingest_service.py's _finalize) — everything else is
    opaque as far as the backend is concerned, so the SDK and frontend should be free to
    add fields to the trace event body without a backend schema change. Contrast with
    RunEndEvent.status below, which the backend genuinely owns (it drives `runs.status`,
    a Postgres enum) and stays strictly typed."""

    model_config = ConfigDict(alias_generator=CamelModel.model_config["alias_generator"], populate_by_name=True, from_attributes=True, extra="allow")


class FnCall(PassthroughModel):
    name: str
    args: dict[str, Any]
    returns: dict[str, Any] | None = None
    duration_us: int


class NodeEvent(PassthroughModel):
    kind: Literal["node"] = "node"
    node_id: str
    node_name: str
    seq: int
    visit_index: int
    entered_at: datetime
    exited_at: datetime | None = None


class EdgeEvent(PassthroughModel):
    kind: Literal["edge"] = "edge"
    edge_id: str
    from_node: str
    to_node: str
    edge_type: str  # not a closed Literal — the backend never branches on it, only forwards it
    run_seq: int
    passes_left: int | None = None
    elapsed_us: int
    state_snapshot: dict[str, Any] = {}
    fn_calls: list[FnCall] = []


class RunEndEvent(CamelModel):
    """Sentinel, not a stored trace event — signals ingest to finalize the run.
    See working_context/sequence-diagrams/trace-ingestion.md."""

    kind: Literal["run_end"] = "run_end"
    status: Literal["finished", "failed"]
    error: str | None = None


class UnknownEvent(PassthroughModel):
    """A future event kind the backend doesn't recognize yet. Kept opaque and forwarded
    verbatim (buffer -> blob -> live/query) rather than rejecting the whole ingest batch —
    it just won't contribute to node_stats/loop_count until the backend adds real support
    for it. This is what makes a new SDK event kind non-breaking for ingest."""

    kind: str


IngestEvent = Annotated[
    Union[
        Annotated[NodeEvent, Tag("node")],
        Annotated[EdgeEvent, Tag("edge")],
        Annotated[RunEndEvent, Tag("run_end")],
        Annotated[UnknownEvent, Tag("unknown")],
    ],
    Discriminator(_event_kind),
]


class IngestBatch(CamelModel):
    run_id: uuid.UUID
    graph_name: str
    events: list[IngestEvent] = Field(max_length=MAX_BATCH_EVENTS)
