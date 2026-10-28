import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import settings
from app.models.identity import Session


def _cutoff(now: datetime | None = None) -> datetime:
    """Sessions created before this are expired."""
    return (now or datetime.now(timezone.utc)) - timedelta(days=settings.session_lifetime_days)


async def create(db: AsyncSession, *, token: str, user_id: uuid.UUID, kind: str, device_label: str, ip: str) -> Session:
    session = Session(id=token, user_id=user_id, kind=kind, device_label=device_label, ip=ip)
    db.add(session)
    await db.flush()
    return session


async def get_by_id(db: AsyncSession, token: str) -> Session | None:
    return await db.get(Session, token)


async def get_valid(db: AsyncSession, token: str) -> Session | None:
    """The session for `token` if it exists and is within its lifetime. An expired one is
    deleted on the spot (the caller commits), so it can't be used again."""
    session = await db.get(Session, token)
    if session is None:
        return None
    if session.created_at < _cutoff():
        await db.delete(session)
        await db.flush()
        return None
    return session


async def delete_expired(db: AsyncSession) -> int:
    """Removes every session past its lifetime; returns how many."""
    result = await db.execute(delete(Session).where(Session.created_at < _cutoff()))
    return result.rowcount or 0


async def touch(db: AsyncSession, session: Session) -> None:
    session.last_seen_at = datetime.now(timezone.utc)
    await db.flush()


async def list_by_user(db: AsyncSession, user_id: uuid.UUID) -> list[Session]:
    result = await db.execute(select(Session).where(Session.user_id == user_id, Session.created_at >= _cutoff()).order_by(Session.last_seen_at.desc()))
    return list(result.scalars().all())


async def delete_by_id(db: AsyncSession, token: str) -> None:
    await db.execute(delete(Session).where(Session.id == token))


async def delete_others(db: AsyncSession, user_id: uuid.UUID, keep_token: str) -> None:
    await db.execute(delete(Session).where(Session.user_id == user_id, Session.id != keep_token))
