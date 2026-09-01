import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.identity import User


async def get_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await db.get(User, user_id)


async def get_by_activation_token(db: AsyncSession, token: str) -> User | None:
    result = await db.execute(select(User).where(User.activation_token == token))
    return result.scalar_one_or_none()


async def create(db: AsyncSession, *, email: str, name: str, password_hash: str, role: str, status: str = "active") -> User:
    user = User(email=email, name=name, password_hash=password_hash, role=role, status=status)
    db.add(user)
    await db.flush()
    return user


async def count_all(db: AsyncSession) -> int:
    result = await db.execute(select(func.count()).select_from(User))
    return result.scalar_one()
