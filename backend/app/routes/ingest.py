from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.deps import require_ingest_key
from app.config.db import get_db
from app.models.project import ApiKey
from app.schemas.trace_event import IngestBatch
from app.services import ingest_service

router = APIRouter(tags=["ingest"])


@router.post("/ingest/events", status_code=status.HTTP_202_ACCEPTED)
async def ingest_events(batch: IngestBatch, key: ApiKey = Depends(require_ingest_key), db: AsyncSession = Depends(get_db)):
    await ingest_service.process_batch(db, key, batch)
    return {"ok": True}
