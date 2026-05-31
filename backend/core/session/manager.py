"""
Session Manager — tracks active sessions and their current mode.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
import uuid

from config.settings import settings
from core.permissions.gate import Mode, PermissionGate


class Session:
    def __init__(self, session_id: str, mode: Mode = Mode.CHAT) -> None:
        self.session_id = session_id
        self.mode = mode
        self.gate = PermissionGate(mode)
        self.created_at = datetime.now(UTC)
        self.last_active = datetime.now(UTC)
        self.metadata: dict[str, Any] = {}

    def switch_mode(self, mode: Mode) -> None:
        self.mode = mode
        self.gate = PermissionGate(mode)
        self.touch()

    def touch(self) -> None:
        self.last_active = datetime.now(UTC)

    def is_expired(self) -> bool:
        ttl = timedelta(seconds=settings.session_ttl_seconds)
        return datetime.now(UTC) - self.last_active > ttl


class SessionManager:
    """In-memory session store. Sessions are also persisted to DB (see db/models/session.py)."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self, mode: Mode = Mode.CHAT) -> Session:
        session_id = str(uuid.uuid4())
        session = Session(session_id=session_id, mode=mode)
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        session = self._sessions.get(session_id)
        if session and session.is_expired():
            self.destroy(session_id)
            return None
        if session:
            session.touch()
        return session

    def get_or_create(self, session_id: str | None, mode: Mode = Mode.CHAT) -> Session:
        if session_id:
            session = self.get(session_id)
            if session:
                return session
            # Recreate in-memory with the same ID — covers server restarts,
            # TTL expiry, and resuming a session from chat history.
            session = Session(session_id=session_id, mode=mode)
            self._sessions[session_id] = session
            return session
        return self.create(mode)

    def switch_mode(self, session_id: str, mode: Mode) -> Session | None:
        session = self.get(session_id)
        if session:
            session.switch_mode(mode)
        return session

    def destroy(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def purge_expired(self) -> int:
        expired = [sid for sid, s in self._sessions.items() if s.is_expired()]
        for sid in expired:
            del self._sessions[sid]
        return len(expired)


# Module-level singleton
session_manager = SessionManager()
