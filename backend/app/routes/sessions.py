from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.deps import get_current_session, get_current_user
from app.config.db import get_db
from app.models.identity import Session as SessionModel, User
from app.repositories import session_repository
from app.schemas.identity import SessionOut
from app.services import auth_service

router = APIRouter(tags=["sessions"])


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), current: SessionModel = Depends(get_current_session)):
    sessions = await session_repository.list_by_user(db, user.id)
    return [SessionOut.model_validate(s).model_copy(update={"current": s.id == current.id}) for s in sessions]


@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    target = await session_repository.get_by_id(db, session_id)
    if target and target.user_id == user.id:
        await session_repository.delete_by_id(db, session_id)
        await db.commit()
    return {"ok": True}


@router.delete("/sessions")
async def revoke_other_sessions(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), current: SessionModel = Depends(get_current_session)):
    await auth_service.sign_out_others(db, user_id=user.id, keep_token=current.id)
    await db.commit()
    return {"ok": True}
