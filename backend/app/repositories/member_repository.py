import uuid

from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import ProjectMember
from app.models.identity import User


async def list_by_project(db: AsyncSession, project_id: uuid.UUID) -> list[User]:
    result = await db.execute(select(User).join(ProjectMember, ProjectMember.user_id == User.id).where(ProjectMember.project_id == project_id))
    return list(result.scalars().all())


async def get_membership(db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectMember | None:
    result = await db.execute(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id))
    return result.scalar_one_or_none()


async def add(db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID) -> None:
    db.add(ProjectMember(project_id=project_id, user_id=user_id))
    await db.flush()


async def remove(db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID) -> None:
    await db.execute(sa_delete(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id))
