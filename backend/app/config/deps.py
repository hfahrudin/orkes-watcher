import uuid

from fastapi import Cookie, Depends, HTTPException, Path, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import settings
from app.utils.security import split_api_key, verify_api_key_secret
from app.config.db import get_db
from app.models.identity import Session, User
from app.models.project import ApiKey, Project
from app.repositories import api_key_repository, member_repository, project_repository, session_repository, user_repository


async def get_current_session(
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> Session:
    if not session_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    session = await session_repository.get_by_id(db, session_token)
    if not session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired or revoked")
    await session_repository.touch(db, session)
    return session


async def get_current_user(db: AsyncSession = Depends(get_db), session: Session = Depends(get_current_session)) -> User:
    user = await user_repository.get_by_id(db, session.user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account no longer exists")
    return user


def require_role(*roles: str):
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires one of roles: {', '.join(roles)}")
        return user

    return _check


async def get_project_or_404(project_id: uuid.UUID = Path(...), db: AsyncSession = Depends(get_db)) -> Project:
    project = await project_repository.get(db, project_id)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project


async def check_project_access(db: AsyncSession, project: Project, user: User) -> None:
    """Read access: admin sees everything; everyone else needs a project_members grant."""
    if user.role == "admin":
        return
    membership = await member_repository.get_membership(db, project.id, user.id)
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this project")


async def require_project_access(
    project: Project = Depends(get_project_or_404),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Project:
    await check_project_access(db, project, user)
    return project


async def get_api_key(request: Request, db: AsyncSession = Depends(get_db)) -> ApiKey:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing API key")
    full_key = auth[7:].strip()
    parsed = split_api_key(full_key)
    if not parsed:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed API key")
    prefix, secret = parsed
    key = await api_key_repository.get_by_prefix(db, prefix)
    if not key or key.scope == "revoked" or not verify_api_key_secret(secret, key.secret_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or revoked API key")
    return key


async def require_ingest_key(key: ApiKey = Depends(get_api_key)) -> ApiKey:
    if key.scope != "ingest":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Key does not have ingest scope")
    return key
