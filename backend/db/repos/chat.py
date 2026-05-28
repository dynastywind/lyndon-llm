"""
CRUD operations for chat sessions and messages.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.chat import ChatMessage, ChatSession


class ChatRepo:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Sessions ──────────────────────────────────────────────────────────────

    async def create_session(self, session_id: str, mode: str = "chat") -> ChatSession:
        row = ChatSession(id=session_id, mode=mode)
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def ensure_session(self, session_id: str, mode: str = "chat") -> ChatSession:
        """Return existing DB record or create it — idempotent."""
        row = await self.get_session(session_id)
        if row is None:
            row = await self.create_session(session_id, mode)
        return row

    async def get_session(self, session_id: str) -> ChatSession | None:
        result = await self._db.execute(
            select(ChatSession).where(ChatSession.id == session_id)
        )
        return result.scalar_one_or_none()

    async def list_sessions(
        self,
        mode: str = "chat",
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[ChatSession], int]:
        total: int = (
            await self._db.execute(
                select(func.count())
                .select_from(ChatSession)
                .where(ChatSession.mode == mode)
            )
        ).scalar_one()

        rows = list(
            (
                await self._db.execute(
                    select(ChatSession)
                    .where(ChatSession.mode == mode)
                    .order_by(ChatSession.updated_at.desc())
                    .limit(limit)
                    .offset(offset)
                )
            ).scalars()
        )
        return rows, total

    async def maybe_set_title(self, session_id: str, first_message: str) -> None:
        """Set the session title from the first user message if still untitled."""
        row = await self.get_session(session_id)
        if row and not row.title:
            title = first_message[:50].strip()
            if len(first_message) > 50:
                title += "…"
            await self._db.execute(
                update(ChatSession)
                .where(ChatSession.id == session_id)
                .values(title=title, updated_at=datetime.now(timezone.utc))
            )
            await self._db.commit()
        else:
            await self.touch_session(session_id)

    async def touch_session(self, session_id: str) -> None:
        """Update updated_at so the session floats to the top of recents."""
        await self._db.execute(
            update(ChatSession)
            .where(ChatSession.id == session_id)
            .values(updated_at=datetime.now(timezone.utc))
        )
        await self._db.commit()

    # ── Messages ──────────────────────────────────────────────────────────────

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        tool_name: str | None = None,
    ) -> ChatMessage:
        row = ChatMessage(
            id=str(uuid.uuid4()),
            session_id=session_id,
            role=role,
            content=content,
            tool_name=tool_name,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def get_messages(self, session_id: str) -> list[ChatMessage]:
        rows = list(
            (
                await self._db.execute(
                    select(ChatMessage)
                    .where(ChatMessage.session_id == session_id)
                    .order_by(ChatMessage.created_at)
                )
            ).scalars()
        )
        return rows
