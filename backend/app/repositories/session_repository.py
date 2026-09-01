import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.identity import Session


async def create(db: AsyncSession, *, token: str, user_id: uuid.UUID, kind: str, device_label: str, ip: str) -> Session:
    session = Session(id=token, user_id=user_id, kind=kind, device_label=device_label, ip=ip)
    db.add(session)
    await db.flush()
    return session


async def get_by_id(db: AsyncSession, token: str) -> Session | None:
    return await db.get(Session, token)


async def touch(db: AsyncSession, session: Session) -> None:
    session.last_seen_at = datetime.now(timezone.utc)
    await db.flush()


async def list_by_user(db: AsyncSession, user_id: uuid.UUID) -> list[Session]:
    result = await db.execute(select(Session).where(Session.user_id == user_id).order_by(Session.last_seen_at.desc()))
    return list(result.scalars().all())


async def delete_by_id(db: AsyncSession, token: str) -> None:
    await db.execute(delete(Session).where(Session.id == token))


async def delete_others(db: AsyncSession, user_id: uuid.UUID, keep_token: str) -> None:
    await db.execute(delete(Session).where(Session.user_id == user_id, Session.id != keep_token))
