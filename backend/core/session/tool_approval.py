"""
Per-tool-call approval gate for "ask before acting" mode.

The engine emits a ``tool_permission_request`` SSE event and then awaits
``request_approval()``.  The HTTP approve/reject endpoints call ``resolve()``
from the request handler — both sides run in the same event loop, so
the asyncio.Event wakes up the waiting coroutine immediately.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass
class _Pending:
    event: asyncio.Event = field(default_factory=asyncio.Event)
    approved: bool = False


class ToolApprovalGate:
    def __init__(self) -> None:
        self._pending: dict[tuple[str, str], _Pending] = {}

    async def request_approval(
        self, session_id: str, call_id: str, timeout: float = 120.0
    ) -> bool:
        """Block until the user approves/rejects or the timeout expires (→ reject)."""
        key = (session_id, call_id)
        pending = _Pending()
        self._pending[key] = pending
        try:
            await asyncio.wait_for(pending.event.wait(), timeout=timeout)
        except TimeoutError:
            return False
        finally:
            self._pending.pop(key, None)
        return pending.approved

    def resolve(self, session_id: str, call_id: str, *, approved: bool) -> bool:
        """Set the approval result. Returns False if no matching pending request."""
        key = (session_id, call_id)
        pending = self._pending.get(key)
        if pending is None:
            return False
        pending.approved = approved
        pending.event.set()
        return True


# Module-level singleton shared across the process
tool_approval_gate = ToolApprovalGate()
