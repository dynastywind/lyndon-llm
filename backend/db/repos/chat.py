"""
CRUD operations for chat sessions and messages.
"""

from __future__ import annotations

from datetime import UTC, datetime
import json
import uuid

from sqlalchemy import exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.chat import ChatMessage, ChatSession


def _make_snippet(content: str, query: str, radius: int = 60) -> str:
    """Return a ~120-char excerpt of *content* centred on the first match of *query*."""
    idx = content.lower().find(query.lower())
    if idx == -1:
        return content[:120]
    start = max(0, idx - radius)
    end = min(len(content), idx + len(query) + radius)
    snippet = content[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(content):
        snippet = snippet + "…"
    return snippet


class ChatRepo:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Sessions ──────────────────────────────────────────────────────────────

    async def create_session(
        self, session_id: str, mode: str = "chat", user_id: str | None = None
    ) -> ChatSession:
        row = ChatSession(id=session_id, mode=mode, user_id=user_id)
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def ensure_session(
        self, session_id: str, mode: str = "chat", user_id: str | None = None
    ) -> ChatSession:
        """Return existing DB record or create it — idempotent."""
        row = await self.get_session(session_id)
        if row is None:
            row = await self.create_session(session_id, mode, user_id=user_id)
        return row

    async def get_session(self, session_id: str) -> ChatSession | None:
        result = await self._db.execute(select(ChatSession).where(ChatSession.id == session_id))
        return result.scalar_one_or_none()

    async def list_sessions(
        self,
        mode: str = "chat",
        limit: int = 20,
        offset: int = 0,
        user_id: str | None = None,
    ) -> tuple[list[ChatSession], int]:
        base_filter = [ChatSession.mode == mode]
        if user_id is not None:
            base_filter.append(ChatSession.user_id == user_id)

        total: int = (
            await self._db.execute(
                select(func.count()).select_from(ChatSession).where(*base_filter)
            )
        ).scalar_one()

        rows = list(
            (
                await self._db.execute(
                    select(ChatSession)
                    .where(*base_filter)
                    .order_by(ChatSession.updated_at.desc())
                    .limit(limit)
                    .offset(offset)
                )
            ).scalars()
        )
        return rows, total

    async def search_sessions(
        self,
        query: str,
        mode: str = "chat",
        user_id: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[ChatSession], int, dict[str, str]]:
        """
        Return sessions whose title OR message content matches *query* (LIKE).

        Also returns a snippet map ``{session_id: excerpt}`` with a ~120-char
        excerpt of the first matching message centred around the matched text.
        Sessions that match only by title carry no snippet.
        """
        like_q = f"%{query}%"
        base_filter = [ChatSession.mode == mode]
        if user_id is not None:
            base_filter.append(ChatSession.user_id == user_id)

        match_cond = or_(
            ChatSession.title.ilike(like_q),
            exists().where(
                ChatMessage.session_id == ChatSession.id,
                ChatMessage.content.ilike(like_q),
                ChatMessage.role != "tool",
            ),
        )

        total: int = (
            await self._db.execute(
                select(func.count())
                .select_from(ChatSession)
                .where(*base_filter, match_cond)
            )
        ).scalar_one()

        rows = list(
            (
                await self._db.execute(
                    select(ChatSession)
                    .where(*base_filter, match_cond)
                    .order_by(ChatSession.updated_at.desc())
                    .limit(limit)
                    .offset(offset)
                )
            ).scalars()
        )

        # Build snippet map: one query to get first matching message per session
        snippets: dict[str, str] = {}
        if rows:
            session_ids = [r.id for r in rows]
            msg_rows = list(
                (
                    await self._db.execute(
                        select(ChatMessage)
                        .where(
                            ChatMessage.session_id.in_(session_ids),
                            ChatMessage.content.ilike(like_q),
                            ChatMessage.role != "tool",
                        )
                        .order_by(ChatMessage.session_id, ChatMessage.created_at)
                    )
                ).scalars()
            )
            seen: set[str] = set()
            for msg in msg_rows:
                if msg.session_id not in seen:
                    seen.add(msg.session_id)
                    snippets[msg.session_id] = _make_snippet(msg.content, query)

        return rows, total, snippets

    async def set_streaming(self, session_id: str, value: bool) -> None:
        """Mark a session as having an active (or finished) LLM background task."""
        await self._db.execute(
            update(ChatSession).where(ChatSession.id == session_id).values(streaming=value)
        )
        await self._db.commit()

    async def clear_all_streaming(self) -> None:
        """Reset every streaming flag — called at server startup to clear stale state."""
        await self._db.execute(update(ChatSession).values(streaming=False))
        await self._db.commit()

    async def rename_session(self, session_id: str, title: str) -> bool:
        """Rename a session. Returns False if the session doesn't exist."""
        row = await self.get_session(session_id)
        if row is None:
            return False
        await self._db.execute(
            update(ChatSession)
            .where(ChatSession.id == session_id)
            .values(title=title.strip() or None, updated_at=datetime.now(UTC))
        )
        await self._db.commit()
        return True

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
                .values(title=title, updated_at=datetime.now(UTC))
            )
            await self._db.commit()
        else:
            await self.touch_session(session_id)

    async def delete_session(self, session_id: str) -> bool:
        """Delete a session and all its messages (cascade). Returns True if it existed."""
        row = await self.get_session(session_id)
        if row is None:
            return False
        await self._db.delete(row)
        await self._db.commit()
        return True

    async def touch_session(self, session_id: str) -> None:
        """Update updated_at so the session floats to the top of recents."""
        await self._db.execute(
            update(ChatSession)
            .where(ChatSession.id == session_id)
            .values(updated_at=datetime.now(UTC))
        )
        await self._db.commit()

    # ── Messages ──────────────────────────────────────────────────────────────

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        tool_name: str | None = None,
        attachments: list[dict] | None = None,
        tool_calls: list[dict] | None = None,
        skill_prefix: str | None = None,
    ) -> ChatMessage:
        """
        Persist a message.  `attachments` is a list of
        ``{name, type, data}`` dicts (``data`` is raw base64).
        """
        row = ChatMessage(
            id=str(uuid.uuid4()),
            session_id=session_id,
            role=role,
            content=content,
            tool_name=tool_name,
            attachments_json=json.dumps(attachments) if attachments else None,
            tool_calls_json=json.dumps(tool_calls) if tool_calls else None,
            skill_prefix=skill_prefix,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    @staticmethod
    def _tool_calls(msg: ChatMessage) -> list[dict]:
        """Decode the JSON tool calls list, returning [] when absent."""
        if not msg.tool_calls_json:
            return []
        try:
            return json.loads(msg.tool_calls_json)
        except (ValueError, TypeError):
            return []

    @staticmethod
    def _attachments(msg: ChatMessage) -> list[dict]:
        """Decode the JSON attachment list, returning [] when absent."""
        if not msg.attachments_json:
            return []
        try:
            return json.loads(msg.attachments_json)
        except (ValueError, TypeError):
            return []

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

    async def get_messages_before(
        self,
        session_id: str,
        limit: int = 5,
        before: datetime | None = None,
    ) -> tuple[list[ChatMessage], bool]:
        """
        Return up to `limit` messages in chronological order, newest-first
        in the DB query so we get the right slice, then reversed for display.

        `before` is a cursor: only messages created strictly before this
        timestamp are returned. This is stable even as new messages stream in.

        Returns (messages_asc, has_more) where has_more=True means older
        messages still exist before the returned batch.
        """
        q = select(ChatMessage).where(ChatMessage.session_id == session_id)
        if before is not None:
            q = q.where(ChatMessage.created_at < before)

        # Fetch limit+1 to cheaply detect whether there are more
        q = q.order_by(ChatMessage.created_at.desc()).limit(limit + 1)
        rows = list((await self._db.execute(q)).scalars())

        has_more = len(rows) > limit
        rows = rows[:limit]  # drop the probe row
        return list(reversed(rows)), has_more
