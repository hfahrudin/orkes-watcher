import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.config.db import Base

RunStatus = Enum("running", "finished", "failed", name="run_status")


class Run(Base):
    __tablename__ = "runs"
    # Dashboard queries filter by project and a start-time range.
    __table_args__ = (Index("ix_runs_project_started", "project_id", "started_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    graph_name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(RunStatus, nullable=False, default="running")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    node_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    edge_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    loop_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    elapsed_us: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # orkes contract fields (docs/contracts/contract-1.0.md §2). graph_nodes is the graph's full
    # node list from the first batch that carried one; it may stay null if that batch was lost.
    failed_node: Mapped[str | None] = mapped_column(String, nullable=True)
    graph_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    graph_nodes: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    contract_version: Mapped[str | None] = mapped_column(String, nullable=True)
    sdk_version: Mapped[str | None] = mapped_column(String, nullable=True)
    # Graph state when the run ended (run_end.final_state). Up to 256 KB, so it's only loaded
    # on request (run_repository.get); NULL for older SDKs and abandoned runs.
    final_state: Mapped[Any] = mapped_column(JSONB(none_as_null=True), nullable=True, deferred=True, deferred_raiseload=True)
    # Last time any batch arrived for this run. Drives the abandoned-run sweep.
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RunNodeStat(Base):
    """Per-run, per-node timing, written when a run finishes, so node timing can be
    filtered by time range and graph on the dashboard."""

    __tablename__ = "run_node_stats"
    __table_args__ = (Index("ix_run_node_stats_project_node", "project_id", "node_name"),)

    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    node_name: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    visits: Mapped[int] = mapped_column(Integer, nullable=False)
    total_us: Mapped[int] = mapped_column(BigInteger, nullable=False)
