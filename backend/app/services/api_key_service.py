import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.security import generate_api_key
from app.models.project import ApiKey
from app.repositories import api_key_repository


async def create_key(db: AsyncSession, *, project_id: uuid.UUID, label: str, scope: str, created_by: uuid.UUID) -> tuple[ApiKey, str]:
    prefix, secret_hash, full_key = generate_api_key(scope)
    key = await api_key_repository.create(db, project_id=project_id, label=label, prefix=prefix, secret_hash=secret_hash, scope=scope, created_by=created_by)
    return key, full_key


async def revoke_key(db: AsyncSession, key: ApiKey) -> None:
    await api_key_repository.revoke(db, key)
