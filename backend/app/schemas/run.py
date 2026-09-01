import uuid
from datetime import datetime
from typing import Literal

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


class NodeStatOut(CamelModel):
    node_id: str
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
