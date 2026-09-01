import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.security import hash_password, new_activation_token
from app.models.identity import User
from app.repositories import member_repository, user_repository

ACTIVATION_TOKEN_TTL = timedelta(days=7)


async def invite_member(db: AsyncSession, *, project_id: uuid.UUID, email: str, role: str) -> tuple[User, str | None]:
    user = await user_repository.get_by_email(db, email)
    activation_token: str | None = None
    if not user:
        # Placeholder password hash — an invited account has no usable password until it's
        # activated via the token below.
        activation_token = new_activation_token()
        user = await user_repository.create(db, email=email, name=email.split("@")[0], password_hash=hash_password(uuid.uuid4().hex), role=role, status="invited")
        user.activation_token = activation_token
        user.activation_token_expires_at = datetime.now(timezone.utc) + ACTIVATION_TOKEN_TTL
        await db.flush()
    existing = await member_repository.get_membership(db, project_id, user.id)
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "User already has access to this project")
    await member_repository.add(db, project_id, user.id)
    return user, activation_token


async def regenerate_activation(db: AsyncSession, user: User) -> str:
    if user.status != "invited":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User has already activated their account")
    token = new_activation_token()
    user.activation_token = token
    user.activation_token_expires_at = datetime.now(timezone.utc) + ACTIVATION_TOKEN_TTL
    await db.flush()
    return token


async def update_member_role(db: AsyncSession, user: User, role: str) -> User:
    user.role = role
    await db.flush()
    return user


async def remove_member(db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID) -> None:
    await member_repository.remove(db, project_id, user_id)
