import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.deps import check_project_access, get_current_user, require_project_access
from app.config.db import get_db
from app.models.identity import User
from app.models.project import Project
from app.models.run import Run
from app.repositories import project_repository, run_repository
from app.schemas.run import ProjectStatsOut, RunOut
from app.services import query_service

router = APIRouter(tags=["runs"])


@router.get("/projects/{project_id}/stats", response_model=ProjectStatsOut)
async def get_project_stats(project: Project = Depends(require_project_access), db: AsyncSession = Depends(get_db)):
    return await query_service.get_project_stats(db, project.id)


@router.get("/projects/{project_id}/runs", response_model=list[RunOut])
async def list_runs(
    project: Project = Depends(require_project_access),
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await run_repository.list_by_project(db, project.id, status=status_filter, search=search)


async def get_run_with_access(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)) -> Run:
    run = await run_repository.get(db, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    project = await project_repository.get(db, run.project_id)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    await check_project_access(db, project, user)
    return run


@router.get("/runs/{run_id}", response_model=RunOut)
async def get_run(run: Run = Depends(get_run_with_access)):
    return run


@router.get("/runs/{run_id}/events")
async def get_run_events(run: Run = Depends(get_run_with_access)):
    return await query_service.get_run_events(run)
