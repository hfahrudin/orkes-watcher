import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel
from app.schemas.identity import Role

Env = Literal["production", "staging", "local"]
KeyScope = Literal["ingest", "read", "revoked"]


class ProjectOut(CamelModel):
    id: uuid.UUID
    name: str
    env: Env
    retention_days: int
    sampling_pct: int
    created_at: datetime


class ProjectCreate(CamelModel):
    name: str
    env: Env = "production"


class ProjectUpdate(CamelModel):
    name: str | None = None
    retention_days: int | None = Field(default=None, ge=1)
    sampling_pct: int | None = Field(default=None, ge=1, le=100)


class MemberOut(CamelModel):
    user_id: uuid.UUID
    project_id: uuid.UUID
    name: str
    email: str
    role: Role


class MemberCreate(CamelModel):
    email: str
    role: Role = "developer"


class MemberRoleUpdate(CamelModel):
    role: Role


class ApiKeyOut(CamelModel):
    id: uuid.UUID
    project_id: uuid.UUID
    label: str
    prefix: str
    scope: KeyScope
    created_by: uuid.UUID
    last_used_at: datetime | None
    created_at: datetime


class ApiKeyCreate(CamelModel):
    label: str
    scope: Literal["ingest", "read"] = "ingest"


class ApiKeyCreateResponse(CamelModel):
    key: ApiKeyOut
    secret: str
