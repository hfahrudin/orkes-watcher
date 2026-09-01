import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.config.db import Base

RunStatus = Enum("running", "finished", "failed", name="run_status")


class Run(Base):
    __tablename__ = "runs"

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


class NodeStat(Base):
    __tablename__ = "node_stats"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    node_id: Mapped[str] = mapped_column(String, primary_key=True)
    node_name: Mapped[str] = mapped_column(String, nullable=False)
    run_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    visit_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_duration_us: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
