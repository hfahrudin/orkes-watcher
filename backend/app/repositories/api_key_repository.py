import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import ApiKey


async def create(db: AsyncSession, *, project_id: uuid.UUID, label: str, prefix: str, secret_hash: str, scope: str, created_by: uuid.UUID) -> ApiKey:
    key = ApiKey(project_id=project_id, label=label, prefix=prefix, secret_hash=secret_hash, scope=scope, created_by=created_by)
    db.add(key)
    await db.flush()
    return key


async def list_by_project(db: AsyncSession, project_id: uuid.UUID) -> list[ApiKey]:
    result = await db.execute(select(ApiKey).where(ApiKey.project_id == project_id).order_by(ApiKey.created_at))
    return list(result.scalars().all())


async def get_by_prefix(db: AsyncSession, prefix: str) -> ApiKey | None:
    result = await db.execute(select(ApiKey).where(ApiKey.prefix == prefix))
    return result.scalar_one_or_none()


async def get(db: AsyncSession, key_id: uuid.UUID) -> ApiKey | None:
    return await db.get(ApiKey, key_id)


async def revoke(db: AsyncSession, key: ApiKey) -> None:
    key.scope = "revoked"
    await db.flush()


async def touch_last_used(db: AsyncSession, key: ApiKey) -> None:
    key.last_used_at = datetime.now(timezone.utc)
    await db.flush()
