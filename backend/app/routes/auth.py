from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import settings
from app.config.deps import get_current_session, get_current_user
from app.config.db import get_db
from app.models.identity import Session as SessionModel, User
from app.schemas.identity import ActivateRequest, ChangePasswordRequest, LoginRequest, UpdateMeRequest, UserOut
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


@router.post("/auth/activate", response_model=UserOut)
async def activate(body: ActivateRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    try:
        user, session = await auth_service.activate_account(
            db, token=body.token, password=body.password, name=body.name, ip=request.client.host if request.client else "", user_agent=request.headers.get("user-agent", "")
        )
    except auth_service.InvalidActivation:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Activation link is invalid or has expired")
    await db.commit()
    response.set_cookie(settings.session_cookie_name, session.id, httponly=True, samesite="lax", secure=settings.cookie_secure, max_age=60 * 60 * 24 * 30)
    return user


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(body: UpdateMeRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    updated = await auth_service.update_profile(db, user, name=body.name)
    await db.commit()
    return updated


@router.post("/me/change-password")
async def change_password(body: ChangePasswordRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        await auth_service.change_password(db, user, current_password=body.current_password, new_password=body.new_password)
    except auth_service.InvalidCredentials:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    await db.commit()
    return {"ok": True}
