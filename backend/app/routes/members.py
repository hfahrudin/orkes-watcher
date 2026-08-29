import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.deps import require_project_access, require_role
from app.config.db import get_db
from app.models.identity import User
from app.models.project import Project
from app.repositories import member_repository, user_repository
from app.schemas.project import MemberCreate, MemberOut, MemberRoleUpdate
from app.services import member_service

router = APIRouter(tags=["members"])


def _to_member_out(project_id: uuid.UUID, user: User) -> MemberOut:
    return MemberOut(user_id=user.id, project_id=project_id, name=user.name, email=user.email, role=user.role)


@router.get("/projects/{project_id}/members", response_model=list[MemberOut])
async def list_members(project: Project = Depends(require_project_access), db: AsyncSession = Depends(get_db)):
    users = await member_repository.list_by_project(db, project.id)
    return [_to_member_out(project.id, u) for u in users]


@router.post("/projects/{project_id}/members", response_model=MemberOut)
async def add_member(
    body: MemberCreate,
    project: Project = Depends(require_project_access),
    _user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    user = await member_service.invite_member(db, project_id=project.id, email=body.email, role=body.role)
    await db.commit()
    return _to_member_out(project.id, user)


@router.patch("/projects/{project_id}/members/{user_id}", response_model=MemberOut)
async def update_member_role(
    body: MemberRoleUpdate,
    user_id: uuid.UUID,
    project: Project = Depends(require_project_access),
    _admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    target = await user_repository.get_by_id(db, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    updated = await member_service.update_member_role(db, target, body.role)
    await db.commit()
    return _to_member_out(project.id, updated)


@router.delete("/projects/{project_id}/members/{user_id}")
async def remove_member(
    user_id: uuid.UUID,
    project: Project = Depends(require_project_access),
    _admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await member_service.remove_member(db, project.id, user_id)
    await db.commit()
    return {"ok": True}
