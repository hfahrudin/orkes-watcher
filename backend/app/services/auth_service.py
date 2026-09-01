from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.security import hash_password, new_session_token, verify_password
from app.models.identity import Session
from app.models.identity import User
from app.repositories import session_repository, user_repository


class InvalidCredentials(Exception):
    pass


class InvalidActivation(Exception):
    pass


async def login(db: AsyncSession, *, email: str, password: str, ip: str, user_agent: str) -> tuple[User, Session]:
    user = await user_repository.get_by_email(db, email)
    if not user or not verify_password(password, user.password_hash):
        raise InvalidCredentials()
    token = new_session_token()
    session = await session_repository.create(db, token=token, user_id=user.id, kind="browser", device_label=user_agent[:200], ip=ip)
    return user, session


async def logout(db: AsyncSession, token: str) -> None:
    await session_repository.delete_by_id(db, token)


async def sign_out_others(db: AsyncSession, *, user_id, keep_token: str) -> None:
    await session_repository.delete_others(db, user_id, keep_token)


async def activate_account(db: AsyncSession, *, token: str, password: str, name: str | None, ip: str, user_agent: str) -> tuple[User, Session]:
    user = await user_repository.get_by_activation_token(db, token)
    if not user or user.status != "invited":
        raise InvalidActivation()
    if not user.activation_token_expires_at or user.activation_token_expires_at < datetime.now(timezone.utc):
        raise InvalidActivation()
    user.password_hash = hash_password(password)
    user.status = "active"
    user.activation_token = None
    user.activation_token_expires_at = None
    if name:
        user.name = name
    await db.flush()
    session_token = new_session_token()
    session = await session_repository.create(db, token=session_token, user_id=user.id, kind="browser", device_label=user_agent[:200], ip=ip)
    return user, session


async def update_profile(db: AsyncSession, user: User, *, name: str) -> User:
    user.name = name
    await db.flush()
    return user


async def change_password(db: AsyncSession, user: User, *, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise InvalidCredentials()
    user.password_hash = hash_password(new_password)
    await db.flush()
