import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project, ProjectMember


async def create(db: AsyncSession, *, name: str, env: str) -> Project:
    project = Project(name=name, env=env)
    db.add(project)
    await db.flush()
    return project


async def get(db: AsyncSession, project_id: uuid.UUID) -> Project | None:
    return await db.get(Project, project_id)


async def list_for_user(db: AsyncSession, *, user_id: uuid.UUID, is_admin: bool) -> list[Project]:
    if is_admin:
        result = await db.execute(select(Project).order_by(Project.created_at))
        return list(result.scalars().all())
    result = await db.execute(
        select(Project).join(ProjectMember, ProjectMember.project_id == Project.id).where(ProjectMember.user_id == user_id).order_by(Project.created_at)
    )
    return list(result.scalars().all())


async def update(db: AsyncSession, project: Project, **fields) -> Project:
    for key, value in fields.items():
        if value is not None:
            setattr(project, key, value)
    await db.flush()
    return project


async def delete(db: AsyncSession, project: Project) -> None:
    await db.delete(project)
