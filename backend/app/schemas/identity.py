import uuid
from datetime import datetime
from typing import Literal

from app.schemas.base import CamelModel

Role = Literal["admin", "developer", "viewer"]


class UserOut(CamelModel):
    id: uuid.UUID
    email: str
    name: str
    role: Role
    status: Literal["active", "invited"]


class SessionOut(CamelModel):
    id: str
    kind: Literal["browser", "cli"]
    device_label: str
    ip: str
    created_at: datetime
    last_seen_at: datetime
    current: bool = False


class LoginRequest(CamelModel):
    email: str
    password: str
