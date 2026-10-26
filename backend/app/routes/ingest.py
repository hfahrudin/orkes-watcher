import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.db import get_db
from app.config.deps import require_ingest_key
from app.config.version import SUPPORTED_CONTRACT_MAJORS, contract_major
from app.models.project import ApiKey
from app.schemas.trace_event import MAX_BODY_BYTES, MAX_JSON_DEPTH, IngestBatch
from app.services import ingest_service

router = APIRouter(tags=["ingest"])


async def _read_limited_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Request body over {MAX_BODY_BYTES} bytes")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BODY_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Request body over {MAX_BODY_BYTES} bytes")
    return bytes(body)


class _NonFiniteNumber(ValueError):
    pass


def _reject_non_finite(token: str):
    # json.loads accepts NaN / Infinity / -Infinity, which aren't JSON: they'd be stored and
    # then break every later read of the run (JSON responses can't contain them).
    raise _NonFiniteNumber(token)


def _too_deep(value, limit: int = MAX_JSON_DEPTH) -> bool:
    """Iterative depth check (a recursive one would itself hit the recursion limit)."""
    stack = [(value, 1)]
    while stack:
        node, depth = stack.pop()
        if depth > limit:
            return True
        if isinstance(node, dict):
            stack.extend((v, depth + 1) for v in node.values())
        elif isinstance(node, list):
            stack.extend((v, depth + 1) for v in node)
    return False


def _invalid(msg: str, kind: str) -> RequestValidationError:
    return RequestValidationError([{"type": kind, "loc": ("body",), "msg": msg, "input": None}])


@router.post("/ingest/events", status_code=status.HTTP_202_ACCEPTED)
async def ingest_events(request: Request, key: ApiKey = Depends(require_ingest_key), db: AsyncSession = Depends(get_db)):
    """Contract: working_context/INTEGRATION_AGREEMENT.md §2. The body is parsed by hand so
    the size limit (413) and contract version (400) are checked before full validation:
    a payload from an unsupported contract major gets a clear 400, not a confusing 422."""
    raw = await _read_limited_body(request)
    try:
        payload = json.loads(raw, parse_constant=_reject_non_finite)
    except _NonFiniteNumber as e:
        raise _invalid(f"{e} is not a valid JSON number; send null or a finite number", "number_not_finite")
    except (json.JSONDecodeError, UnicodeDecodeError, RecursionError):
        raise _invalid("Body is not valid JSON", "json_invalid")
    if _too_deep(payload):
        raise _invalid(f"JSON nested more than {MAX_JSON_DEPTH} levels deep", "json_too_deep")

    version = payload.get("contract_version") if isinstance(payload, dict) else None
    major = contract_major(version) if isinstance(version, str) else None
    if major is not None and major not in SUPPORTED_CONTRACT_MAJORS:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "unsupported_contract_version", "supported": [str(m) for m in SUPPORTED_CONTRACT_MAJORS]},
        )

    try:
        batch = IngestBatch.model_validate(payload)
    except ValidationError as e:
        raise RequestValidationError(e.errors(include_url=False))

    await ingest_service.process_batch(db, key, batch)
    return {"ok": True}
