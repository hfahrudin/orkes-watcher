"""Ingest wire format: orkes trace contract 1.0.

The source of truth is docs/contracts/contract-1.0.md §2. orkes is the master:
field names, units (seconds) and status strings are orkes's own, snake_case, with no
camelCase aliasing. The backend only reads a few fields per event (see
ingest_service._finalize). Everything else, including fields it doesn't know about yet,
is stored and forwarded unchanged.
"""

import uuid
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Discriminator, Field, Tag, model_validator

MAX_BATCH_EVENTS = 5000
MAX_BODY_BYTES = 5 * 1024 * 1024
# Deeper JSON can't be written back out (json.dumps recursion), so it's rejected on the way in.
MAX_JSON_DEPTH = 64
# Unix seconds. Anything outside 1970..2100 is a bug in the sender, not a real time.
MAX_TIMESTAMP = 4_102_444_800.0
# Seconds. A run or step longer than ~1 year is a bug in the sender.
MAX_DURATION = 31_536_000.0

_KNOWN_KINDS = ("edge", "run_end")


def _event_kind(v: Any) -> str:
    """Routes any kind the backend doesn't recognize to UnknownEvent, instead of
    rejecting the whole batch (a new event kind is a contract MINOR bump)."""
    k = v.get("kind") if isinstance(v, dict) else getattr(v, "kind", None)
    return k if k in _KNOWN_KINDS else "unknown"


class PassthroughModel(BaseModel):
    """Undeclared fields are kept (extra="allow") and forwarded, never dropped."""

    model_config = ConfigDict(extra="allow")


class SdkInfo(PassthroughModel):
    name: str
    version: str


class GraphNode(PassthroughModel):
    """One entry of the graph's node list (orkes `NodeTrace`)."""

    node_id: str
    node_name: str
    node_description: str | None = None
    meta: Any = {}


class EdgeEvent(PassthroughModel):
    """orkes `EdgeTrace` plus `kind`. Only the first five fields are read by the backend;
    the rest are typed loosely because any of them may be a `{"_truncated": true}` marker."""

    kind: Literal["edge"] = "edge"
    edge_id: str
    edge_run_number: int
    from_node: str
    to_node: str | list[str]
    edge_type: str | None = None  # not a closed set: forwarded, never branched on
    passes_left: int | None = None
    started_at: float | None = Field(default=None, ge=0, le=MAX_TIMESTAMP)
    elapsed: float = Field(ge=0, le=MAX_DURATION)
    node_elapsed: float | None = Field(default=None, ge=0, le=MAX_DURATION)
    state_snapshot: Any = {}
    meta: Any = {}
    function_traces: Any = []
    llm_traces: Any = []


class RunEndEvent(BaseModel):
    """Finalizes the run. Not stored as a trace event: its fields go onto the `runs` row."""

    kind: Literal["run_end"] = "run_end"
    status: Literal["FINISHED", "FAILED"]
    start_time: float | None = Field(default=None, ge=0, le=MAX_TIMESTAMP)
    elapsed_time: float | None = Field(default=None, ge=0, le=MAX_DURATION)
    error: str | None = None
    failed_node: str | None = None
    # Graph state when the run ended: the output for FINISHED, the state at the failure for
    # FAILED. Optional within 1.0 (older SDKs don't send it); may be a _truncated marker.
    final_state: Any = None


class UnknownEvent(PassthroughModel):
    """An event kind added by a newer orkes. Stored and forwarded as-is; not counted in stats."""

    kind: str


IngestEvent = Annotated[
    Union[
        Annotated[EdgeEvent, Tag("edge")],
        Annotated[RunEndEvent, Tag("run_end")],
        Annotated[UnknownEvent, Tag("unknown")],
    ],
    Discriminator(_event_kind),
]


class IngestBatch(BaseModel):
    contract_version: str = Field(pattern=r"^\d+\.\d+$")
    sdk: SdkInfo
    run_id: uuid.UUID
    graph_name: str
    graph_description: str | None = None
    nodes: list[GraphNode] | None = None
    events: list[IngestEvent] = Field(default=[], max_length=MAX_BATCH_EVENTS)

    @model_validator(mode="after")
    def _run_end_is_last(self) -> "IngestBatch":
        positions = [i for i, e in enumerate(self.events) if isinstance(e, RunEndEvent)]
        if len(positions) > 1:
            raise ValueError("at most one run_end per batch")
        if positions and positions[0] != len(self.events) - 1:
            raise ValueError("run_end must be the last event in the batch")
        return self
