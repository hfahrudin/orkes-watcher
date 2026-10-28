import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.deps import check_project_access, get_current_user, require_project_access
from app.config.db import get_db
from app.models.identity import User
from app.models.project import Project
from app.models.run import Run
from app.repositories import project_repository, run_repository
from app.schemas.run import ProjectStatsOut, RunDetailOut, RunOut, StatsRange
from app.services import query_service

router = APIRouter(tags=["runs"])


@router.get("/projects/{project_id}/stats", response_model=ProjectStatsOut)
async def get_project_stats(
    project: Project = Depends(require_project_access),
    range_key: StatsRange = Query(default="24h", alias="range"),
    graph: str | None = Query(default=None, max_length=500),
    db: AsyncSession = Depends(get_db),
):
    return await query_service.get_project_stats(db, project.id, range_key=range_key, graph=graph or None)


@router.get("/projects/{project_id}/runs", response_model=list[RunOut])
async def list_runs(
    response: Response,
    project: Project = Depends(require_project_access),
    status_filter: Literal["running", "finished", "failed"] | None = Query(default=None, alias="status"),
    search: str | None = None,
    error: str | None = Query(default=None, max_length=500),
    failed_node: str | None = Query(default=None, alias="failedNode", max_length=500),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    # Total matching runs (same filters, ignoring limit/offset), for pagination.
    filters = dict(status=status_filter, search=search, error=error, failed_node=failed_node)
    response.headers["X-Total-Count"] = str(await run_repository.count_by_project(db, project.id, **filters))
    return await run_repository.list_by_project(db, project.id, **filters, limit=limit, offset=offset)


async def get_run_with_access(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)) -> Run:
    run = await run_repository.get(db, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    project = await project_repository.get(db, run.project_id)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    await check_project_access(db, project, user)
    return run


@router.get("/runs/{run_id}", response_model=RunDetailOut)
async def get_run(run: Run = Depends(get_run_with_access)):
    return run


@router.get("/runs/{run_id}/events")
async def get_run_events(run: Run = Depends(get_run_with_access)):
    return await query_service.get_run_events(run)
