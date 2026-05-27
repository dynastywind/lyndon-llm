"""
Event Bus — lightweight pub/sub for internal agent events.
Used to decouple blocks (e.g. Code block emits diff_ready, frontend subscribes).
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any, Callable, Coroutine


EventHandler = Callable[[dict[str, Any]], Coroutine[Any, Any, None]]


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[EventHandler]] = defaultdict(list)

    def on(self, event: str, handler: EventHandler) -> None:
        """Subscribe to an event type."""
        self._handlers[event].append(handler)

    def off(self, event: str, handler: EventHandler) -> None:
        self._handlers[event] = [h for h in self._handlers[event] if h != handler]

    async def emit(self, event: str, payload: dict[str, Any]) -> None:
        """Fire all handlers for an event concurrently."""
        handlers = self._handlers.get(event, [])
        if handlers:
            await asyncio.gather(*(h(payload) for h in handlers))


# Common event names (add more as the system grows)
class Events:
    # Chat
    CHAT_MESSAGE_RECEIVED = "chat.message.received"
    CHAT_RESPONSE_STARTED = "chat.response.started"
    CHAT_RESPONSE_CHUNK   = "chat.response.chunk"
    CHAT_RESPONSE_DONE    = "chat.response.done"
    MEMORY_STORED         = "memory.stored"

    # Cowork
    PLAN_CREATED          = "cowork.plan.created"
    PLAN_APPROVED         = "cowork.plan.approved"
    STEP_STARTED          = "cowork.step.started"
    STEP_DONE             = "cowork.step.done"
    STEP_FAILED           = "cowork.step.failed"
    TASK_DONE             = "cowork.task.done"

    # Code
    DIFF_READY            = "code.diff.ready"
    TESTS_PASSED          = "code.tests.passed"
    TESTS_FAILED          = "code.tests.failed"
    COMMIT_DONE           = "code.commit.done"
    DEPLOY_DONE           = "code.deploy.done"


# Module-level singleton
event_bus = EventBus()
