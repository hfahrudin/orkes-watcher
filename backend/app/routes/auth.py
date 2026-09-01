from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import settings
from app.config.deps import get_current_session, get_current_user
from app.config.db import get_db
from app.models.identity import Session as SessionModel, User
from app.schemas.identity import LoginRequest, UserOut
from app.services import auth_service

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=UserOut)
async def login(body: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    try:
        user, session = await auth_service.login(
            db, email=body.email, password=body.password, ip=request.client.host if request.client else "", user_agent=request.headers.get("user-agent", "")
        )
    except auth_service.InvalidCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    await db.commit()
    response.set_cookie(settings.session_cookie_name, session.id, httponly=True, samesite="lax", secure=settings.cookie_secure, max_age=60 * 60 * 24 * 30)
    return user


@router.post("/auth/logout")
async def logout(response: Response, db: AsyncSession = Depends(get_db), session: SessionModel = Depends(get_current_session)):
    await auth_service.logout(db, session.id)
    await db.commit()
    response.delete_cookie(settings.session_cookie_name, samesite="lax", secure=settings.cookie_secure)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
