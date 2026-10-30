import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.base import CamelModel
from app.schemas.identity import Role

Env = Literal["production", "staging", "local"]
KeyScope = Literal["ingest", "read", "revoked"]


class ProjectOut(CamelModel):
    id: uuid.UUID
    name: str
    env: Env
    retention_days: int | None  # None = never delete
    sampling_pct: int
    abandon_after_minutes: int
    created_at: datetime


class ProjectCreate(CamelModel):
    name: str
    env: Env = "production"


class ProjectUpdate(CamelModel):
    name: str | None = None
    # Only fields present in the request change. retention_days may be sent as null to
    # keep traces forever; the others can't be cleared.
    retention_days: int | None = Field(default=None, ge=1)
    sampling_pct: int | None = Field(default=None, ge=1, le=100)
    abandon_after_minutes: int | None = Field(default=None, ge=1, le=10080)

    @model_validator(mode="after")
    def _only_retention_can_be_cleared(self) -> "ProjectUpdate":
        for field in ("name", "sampling_pct", "abandon_after_minutes"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} can't be null")
        return self


class MemberOut(CamelModel):
    user_id: uuid.UUID
    project_id: uuid.UUID
    name: str
    email: str
    role: Role
    status: Literal["active", "invited"]


class MemberInviteResponse(CamelModel):
    member: MemberOut
    # Only set right after invite/resend, so the caller can hand the invitee a link —
    # there's no email sending yet, see FRONTEND.md's cut list.
    activation_token: str | None = None


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
