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


class RunDetailOut(RunOut):
    """GET /runs/:id only — adds the graph's node list, which can be large."""

    graph_nodes: list[dict[str, Any]] | None


class NodeStatOut(CamelModel):
    node_name: str
    run_count: int
    visit_count: int
    total_duration_us: int


class HourlyBar(CamelModel):
    ok: int
    fail: int


class ProjectStatsOut(CamelModel):
    by_outcome: dict[RunStatus, int]
    slowest_nodes: list[NodeStatOut]
    latest_traces: list[RunOut]
    p95_elapsed_us: int | None
    total_edge_traversals: int
    total_loop_reentries: int
    finished_pct: float
    hourly_bars: list[HourlyBar]
