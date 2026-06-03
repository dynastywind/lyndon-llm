"""
DB / ChatRepo tests using an in-memory SQLite database.

No external services required — all I/O is in-process via aiosqlite.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import os
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


# ── fixture: in-memory async DB session ──────────────────────────────────────


@pytest_asyncio.fixture
async def db():
    """Yield a fresh in-memory AsyncSession for each test."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from db.base import Base
    import db.models.chat  # noqa: F401 — registers tables with Base.metadata

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session

    await engine.dispose()


# ── ensure_session idempotency ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ensure_session_idempotent(db):
    from db.repos.chat import ChatRepo

    repo = ChatRepo(db)
    sid = "idem-session"

    row1 = await repo.ensure_session(sid)
    row2 = await repo.ensure_session(sid)

    assert row1.id == row2.id == sid

    # Only one row should exist
    from sqlalchemy import func, select

    from db.models.chat import ChatSession

    count = (
        await db.execute(select(func.count()).select_from(ChatSession).where(ChatSession.id == sid))
    ).scalar_one()
    assert count == 1


# ── get_messages_before pagination ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_messages_before_pagination(db):
    from db.repos.chat import ChatRepo

    repo = ChatRepo(db)
    sid = "paged-session"
    await repo.ensure_session(sid)

    # Insert 9 messages with distinct timestamps (3 clean pages of 3)
    base_time = datetime(2024, 1, 1, tzinfo=UTC)
    for i in range(9):
        from db.models.chat import ChatMessage

        msg = ChatMessage(
            session_id=sid,
            role="user",
            content=f"message {i}",
            created_at=base_time + timedelta(seconds=i),
        )
        db.add(msg)
    await db.commit()

    # Page 1: 3 newest messages (6, 7, 8)
    cursor = base_time + timedelta(seconds=9)  # after all messages
    page1, has_more1 = await repo.get_messages_before(sid, limit=3, before=cursor)
    assert len(page1) == 3
    assert has_more1 is True
    assert page1[-1].content == "message 8"

    # Page 2: messages 3, 4, 5
    cursor2 = page1[0].created_at
    page2, has_more2 = await repo.get_messages_before(sid, limit=3, before=cursor2)
    assert len(page2) == 3
    assert has_more2 is True

    # Page 3: messages 0, 1, 2 — nothing older, has_more=False
    cursor3 = page2[0].created_at
    page3, has_more3 = await repo.get_messages_before(sid, limit=3, before=cursor3)
    assert len(page3) == 3
    assert has_more3 is False

    # No duplicates across pages
    all_ids = [m.id for m in page1 + page2 + page3]
    assert len(all_ids) == len(set(all_ids))


# ── maybe_set_title ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_maybe_set_title_only_on_first_message(db):
    from db.repos.chat import ChatRepo

    repo = ChatRepo(db)
    sid = "title-session"
    await repo.ensure_session(sid)

    await repo.maybe_set_title(sid, "What is the meaning of life?")
    row = await repo.get_session(sid)
    assert row.title == "What is the meaning of life?"

    # Second call should NOT overwrite
    await repo.maybe_set_title(sid, "A completely different message")
    row2 = await repo.get_session(sid)
    assert row2.title == "What is the meaning of life?"


@pytest.mark.asyncio
async def test_maybe_set_title_truncates_long_message(db):
    from db.repos.chat import ChatRepo

    repo = ChatRepo(db)
    sid = "title-long"
    await repo.ensure_session(sid)

    long_msg = "A" * 100
    await repo.maybe_set_title(sid, long_msg)
    row = await repo.get_session(sid)
    assert len(row.title) <= 51  # 50 chars + ellipsis
    assert row.title.endswith("…")


# ── cascade delete ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_session_cascades_to_messages(db):
    from sqlalchemy import select

    from db.models.chat import ChatMessage
    from db.repos.chat import ChatRepo

    repo = ChatRepo(db)
    sid = "cascade-session"
    await repo.ensure_session(sid)
    await repo.add_message(sid, "user", "hello")
    await repo.add_message(sid, "assistant", "world")

    deleted = await repo.delete_session(sid)
    assert deleted is True

    # Messages must be gone
    msgs = list((await db.execute(select(ChatMessage).where(ChatMessage.session_id == sid))).scalars())
    assert msgs == []


# ── attachment round-trip ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_attachment_round_trip(db):
    from db.repos.chat import ChatRepo

    repo = ChatRepo(db)
    sid = "attach-session"
    await repo.ensure_session(sid)

    attachments = [{"name": "photo.png", "type": "image/png", "data": "abc123=="}]
    await repo.add_message(sid, "user", "see attached", attachments=attachments)

    # Reload and decode
    messages = await repo.get_messages(sid)
    assert len(messages) == 1
    decoded = ChatRepo._attachments(messages[0])
    assert decoded == attachments


# ── delete_session returns False for unknown session ─────────────────────────


@pytest.mark.asyncio
async def test_delete_nonexistent_session_returns_false(db):
    from db.repos.chat import ChatRepo

    repo = ChatRepo(db)
    result = await repo.delete_session("does-not-exist")
    assert result is False
