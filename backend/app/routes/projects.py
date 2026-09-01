from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.deps import get_current_user, require_project_access, require_role
from app.config.db import get_db
from app.models.identity import User
from app.models.project import Project
from app.repositories import project_repository
from app.schemas.project import ProjectCreate, ProjectOut, ProjectUpdate
from app.services import project_service

router = APIRouter(tags=["projects"])


@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await project_service.list_projects(db, user)


@router.post("/projects", response_model=ProjectOut)
async def create_project(body: ProjectCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_role("admin"))):
    project, _first_key_secret = await project_service.create_project(db, name=body.name, env=body.env, creator=user)
    await db.commit()
    return project


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(project: Project = Depends(require_project_access)):
    return project


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    body: ProjectUpdate,
    project: Project = Depends(require_project_access),
    _user: User = Depends(require_role("admin", "developer")),
    db: AsyncSession = Depends(get_db),
):
    updated = await project_repository.update(db, project, **body.model_dump())
    await db.commit()
    return updated


@router.delete("/projects/{project_id}")
async def delete_project(project: Project = Depends(require_project_access), _user: User = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)):
    await project_service.delete_project(db, project)
    await db.commit()
    return {"ok": True}
