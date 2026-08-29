import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.security import hash_password
from app.models.identity import User
from app.repositories import member_repository, user_repository


async def invite_member(db: AsyncSession, *, project_id: uuid.UUID, email: str, role: str) -> User:
    user = await user_repository.get_by_email(db, email)
    if not user:
        # Placeholder password hash — an invited account has no usable password until it's
        # activated. There's no activation flow implemented yet (see FRONTEND.md's cut list).
        user = await user_repository.create(db, email=email, name=email.split("@")[0], password_hash=hash_password(uuid.uuid4().hex), role=role, status="invited")
    existing = await member_repository.get_membership(db, project_id, user.id)
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "User already has access to this project")
    await member_repository.add(db, project_id, user.id)
    return user


async def update_member_role(db: AsyncSession, user: User, role: str) -> User:
    user.role = role
    await db.flush()
    return user


async def remove_member(db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID) -> None:
    await member_repository.remove(db, project_id, user_id)
