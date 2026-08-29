import asyncio
from dataclasses import dataclass, field
from typing import Any


@dataclass
class LiveRun:
    buffer: list[dict[str, Any]] = field(default_factory=list)
    subscribers: set[asyncio.Queue] = field(default_factory=set)


class LiveRegistry:
    """Per-process, in-memory only — the MVP shape from ARCHITECTURE.md. A run's event
    buffer and its live WS subscribers both live here for the run's lifetime; a backend
    restart loses any in-flight (not yet finalized) run's history, same as the frontend
    mock's stance on this tradeoff."""

    def __init__(self) -> None:
        self._runs: dict[str, LiveRun] = {}

    def _get_or_create(self, run_id: str) -> LiveRun:
        return self._runs.setdefault(run_id, LiveRun())

    def buffer(self, run_id: str) -> list[dict[str, Any]]:
        live = self._runs.get(run_id)
        return live.buffer if live else []

    async def publish(self, run_id: str, event: dict[str, Any]) -> None:
        live = self._get_or_create(run_id)
        live.buffer.append(event)
        for queue in list(live.subscribers):
            await queue.put({"type": "event", "data": event})

    async def publish_done(self, run_id: str, status: str) -> None:
        live = self._runs.get(run_id)
        if not live:
            return
        for queue in list(live.subscribers):
            await queue.put({"type": "done", "status": status})

    def subscribe(self, run_id: str) -> asyncio.Queue:
        live = self._get_or_create(run_id)
        queue: asyncio.Queue = asyncio.Queue()
        live.subscribers.add(queue)
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        live = self._runs.get(run_id)
        if live:
            live.subscribers.discard(queue)

    def discard(self, run_id: str) -> None:
        self._runs.pop(run_id, None)


live_registry = LiveRegistry()
