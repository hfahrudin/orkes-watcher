import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.config.db import Base

Env = Enum("production", "staging", "local", name="project_env")
KeyScope = Enum("ingest", "read", "revoked", name="api_key_scope")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    env: Mapped[str] = mapped_column(Env, nullable=False, default="production")
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    sampling_pct: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProjectMember(Base):
    __tablename__ = "project_members"

    # Which projects a person can see — role itself lives on `users` (global to the
    # install), not here. See DATABASE.md.
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    prefix: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    secret_hash: Mapped[str] = mapped_column(String, nullable=False)
    scope: Mapped[str] = mapped_column(KeyScope, nullable=False, default="ingest")
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
