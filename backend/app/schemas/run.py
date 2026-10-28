import uuid
from datetime import datetime
from typing import Any, Literal

from app.schemas.base import CamelModel

RunStatus = Literal["running", "finished", "failed"]


class RunOut(CamelModel):
    id: uuid.UUID
    project_id: uuid.UUID
    graph_name: str
    status: RunStatus
    started_at: datetime
    finished_at: datetime | None
    node_count: int
    edge_count: int
    loop_count: int
    elapsed_us: int | None
    error: str | None
    failed_node: str | None
    graph_description: str | None
    contract_version: str | None
    sdk_version: str | None
    last_event_at: datetime | None


class RunDetailOut(RunOut):
    """GET /runs/:id only — adds the graph's node list, which can be large."""

    graph_nodes: list[dict[str, Any]] | None


class NodeStatOut(CamelModel):
    node_name: str
    run_count: int
    visit_count: int
    total_duration_us: int


StatsRange = Literal["1h", "24h", "7d", "30d"]


class TimelineBucket(CamelModel):
    start: datetime
    ok: int
    fail: int
    # Run time of runs that ended in this bucket's runs (None when none did).
    p50_us: int | None = None
    p95_us: int | None = None


class ErrorGroupOut(CamelModel):
    message: str
    count: int
    last_seen: datetime
    sample_run_id: uuid.UUID


class NodeFailureOut(CamelModel):
    node_name: str
    count: int


class LiveOut(CamelModel):
    running_count: int
    running: list[RunOut]
    abandoned_in_range: int


class ProjectStatsOut(CamelModel):
    range: StatsRange
    graph: str | None
    graph_names: list[str]
    by_outcome: dict[RunStatus, int]
    slowest_nodes: list[NodeStatOut]
    latest_traces: list[RunOut]
    p95_elapsed_us: int | None
    total_edge_traversals: int
    total_loop_reentries: int
    finished_pct: float
    bucket_seconds: int
    timeline: list[TimelineBucket]
    top_errors: list[ErrorGroupOut]
    failures_by_node: list[NodeFailureOut]
    failures_without_node: int
    live: LiveOut
