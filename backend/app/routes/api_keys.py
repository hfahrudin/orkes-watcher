import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.deps import require_project_access, require_role
from app.config.db import get_db
from app.models.identity import User
from app.models.project import Project
from app.repositories import api_key_repository
from app.schemas.project import ApiKeyCreate, ApiKeyCreateResponse, ApiKeyOut
from app.services import api_key_service

router = APIRouter(tags=["api_keys"])


@router.get("/projects/{project_id}/keys", response_model=list[ApiKeyOut])
async def list_keys(project: Project = Depends(require_project_access), db: AsyncSession = Depends(get_db)):
    return await api_key_repository.list_by_project(db, project.id)


@router.post("/projects/{project_id}/keys", response_model=ApiKeyCreateResponse)
async def create_key(
    body: ApiKeyCreate,
    project: Project = Depends(require_project_access),
    user: User = Depends(require_role("admin", "developer")),
    db: AsyncSession = Depends(get_db),
):
    key, secret = await api_key_service.create_key(db, project_id=project.id, label=body.label, scope=body.scope, created_by=user.id)
    await db.commit()
    return ApiKeyCreateResponse(key=key, secret=secret)


@router.delete("/projects/{project_id}/keys/{key_id}")
async def revoke_key(
    key_id: uuid.UUID,
    project: Project = Depends(require_project_access),
    _user: User = Depends(require_role("admin", "developer")),
    db: AsyncSession = Depends(get_db),
):
    key = await api_key_repository.get(db, key_id)
    if not key or key.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Key not found")
    await api_key_service.revoke_key(db, key)
    await db.commit()
    return {"ok": True}
