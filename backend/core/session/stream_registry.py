"""
In-memory registry of active LLM streams.

Each session that has an in-flight LLM call owns a ``StreamBuffer`` stored
here.  Background tasks push events into the buffer; SSE generators subscribe
and replay the accumulated events plus any future ones.

The registry is intentionally process-local: if the server restarts the
buffers are gone (and the ``streaming`` DB flag is cleared at startup so the
frontend shows a clean state instead of waiting forever).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime


class StreamBuffer:
    """
    Accumulator for SSE events produced by a background LLM task.

    Subscribers call :meth:`subscribe` to get an async generator that first
    replays all events accumulated so far and then yields new events as they
    arrive.  Multiple concurrent subscribers are supported (reconnects,
    multiple browser tabs).
    """

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.events: list[dict] = []
        self.done: bool = False
        self.error: str | None = None
        self.started_at: datetime = datetime.now(UTC)
        self._cond: asyncio.Condition = asyncio.Condition()
        # Set by /stream/cancel; the engine checks it between streamed events and
        # stops gracefully (so the partial reply is still persisted).
        self.cancelled: asyncio.Event = asyncio.Event()

    async def push(self, event: dict) -> None:
        """Append an event and wake all waiting subscribers."""
        async with self._cond:
            self.events.append(event)
            self._cond.notify_all()

    async def finish(self, error: str | None = None) -> None:
        """Mark the stream as complete and wake all waiting subscribers."""
        async with self._cond:
            self.done = True
            self.error = error
            self._cond.notify_all()

    async def subscribe(self, start_idx: int = 0):
        """
        Async generator that yields events from *start_idx* onward.

        Blocks when all current events have been delivered and the stream is
        not yet done.  Returns once ``done`` is set and all events are yielded.
        """
        idx = start_idx
        while True:
            batch: list[dict] = []
            reached_end = False
            async with self._cond:
                while idx >= len(self.events) and not self.done:
                    await self._cond.wait()
                batch = self.events[idx:]
                idx += len(batch)
                reached_end = self.done and idx >= len(self.events)
            for event in batch:
                yield event
            if reached_end:
                return


class StreamRegistry:
    """Global registry mapping ``session_id`` → :class:`StreamBuffer`."""

    def __init__(self) -> None:
        self._buffers: dict[str, StreamBuffer] = {}

    def start(self, session_id: str) -> StreamBuffer:
        """Create a new buffer for *session_id*, replacing any previous one."""
        buf = StreamBuffer(session_id)
        self._buffers[session_id] = buf
        return buf

    def get(self, session_id: str) -> StreamBuffer | None:
        """Return the active buffer for *session_id*, or ``None``."""
        return self._buffers.get(session_id)

    def cancel(self, session_id: str) -> bool:
        """Signal the active stream for *session_id* to stop. Returns True if one existed."""
        buf = self._buffers.get(session_id)
        if buf is None:
            return False
        buf.cancelled.set()
        return True

    def remove(self, session_id: str) -> None:
        """Remove the buffer (called when the background LLM task finishes)."""
        self._buffers.pop(session_id, None)


stream_registry = StreamRegistry()
