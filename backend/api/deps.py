"""FastAPI dependency injection helpers."""

from __future__ import annotations

from fastapi import Header

from core.permissions.gate import Mode
from core.session.manager import Session, session_manager


def get_session(
    x_session_id: str | None = Header(default=None),
    x_mode: str | None = Header(default=None),
) -> Session:
    mode = Mode(x_mode) if x_mode in [m.value for m in Mode] else Mode.CHAT
    return session_manager.get_or_create(x_session_id, mode=mode)
