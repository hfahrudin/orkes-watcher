import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.config.settings import settings
from app.config.deps import check_project_access
from app.config.db import SessionLocal
from app.repositories import project_repository, run_repository, session_repository, user_repository
from app.services.live_service import live_registry

router = APIRouter(tags=["live"])


@router.websocket("/runs/{run_id}/live")
async def run_live(websocket: WebSocket, run_id: uuid.UUID):
    """Auth happens before `accept()` — session cookie at handshake, per API.md."""
    token = websocket.cookies.get(settings.session_cookie_name)
    async with SessionLocal() as db:
        session = await session_repository.get_by_id(db, token) if token else None
        if not session:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        user = await user_repository.get_by_id(db, session.user_id)
        run = await run_repository.get(db, run_id)
        if not run or not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        project = await project_repository.get(db, run.project_id)
        if not project:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        try:
            await check_project_access(db, project, user)
        except Exception:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    await websocket.accept()

    if run.status != "running":
        # A finished/failed run never has a live stream — the client should already be
        # reading from GET /runs/:id/events instead. Closing keeps the contract explicit.
        await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)
        return

    queue = live_registry.subscribe(str(run_id))
    try:
        while True:
            message = await queue.get()
            await websocket.send_json(message)
            if message.get("type") == "done":
                break
    except WebSocketDisconnect:
        pass
    finally:
        live_registry.unsubscribe(str(run_id), queue)
        try:
            await websocket.close()
        except RuntimeError:
            pass  # already closed (client disconnected first)
