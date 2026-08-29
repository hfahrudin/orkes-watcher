import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.security import generate_api_key
from app.models.project import Project
from app.models.identity import User
from app.repositories import api_key_repository, member_repository, project_repository


async def create_project(db: AsyncSession, *, name: str, env: str, creator: User) -> tuple[Project, str]:
    """Returns (project, first_ingest_key_secret) — "its first API key is generated on
    create," per the mockup's New Project dialog copy."""
    project = await project_repository.create(db, name=name, env=env)
    await member_repository.add(db, project.id, creator.id)
    prefix, secret_hash, full_key = generate_api_key("ingest")
    await api_key_repository.create(db, project_id=project.id, label="default", prefix=prefix, secret_hash=secret_hash, scope="ingest", created_by=creator.id)
    return project, full_key


async def list_projects(db: AsyncSession, user: User) -> list[Project]:
    return await project_repository.list_for_user(db, user_id=user.id, is_admin=user.role == "admin")


async def delete_project(db: AsyncSession, project: Project) -> None:
    await project_repository.delete(db, project)
