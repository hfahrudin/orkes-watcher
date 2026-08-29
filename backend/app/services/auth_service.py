from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.security import new_session_token, verify_password
from app.models.identity import Session
from app.models.identity import User
from app.repositories import session_repository, user_repository


class InvalidCredentials(Exception):
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
