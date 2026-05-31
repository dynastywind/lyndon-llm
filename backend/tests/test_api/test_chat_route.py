"""
HTTP contract tests for the /api/chat/ routes.

Builds a minimal FastAPI app with only the chat router to avoid the naming
conflict between the project's `code/` package and Python's stdlib `code`
module (which would fire when importing the full api.main app).

Uses an in-memory SQLite database — no real LLM, network, or vector store.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


# ── minimal app fixture ───────────────────────────────────────────────────────


@pytest_asyncio.fixture(scope="module")
async def app():
    """
    Minimal FastAPI app containing only the chat router, wired to an
    in-memory SQLite DB.  No real LLM or vector-store connections.
    """
    import db.models.chat  # noqa: F401 — register models before create_all
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    import db.base as db_base
    from api.routes.chat import router as chat_router

    _app = FastAPI()
    _app.include_router(chat_router, prefix="/api/chat")

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(db_base.Base.metadata.create_all)

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with factory() as session:
            yield session

    _app.dependency_overrides[db_base.get_db] = override_get_db
    return _app


@pytest.fixture
def client(app):
    from httpx import ASGITransport, AsyncClient

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── session CRUD ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_session_returns_session_id(client):
    async with client as c:
        resp = await c.post("/api/chat/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert "session_id" in data
    assert data["mode"] == "chat"


@pytest.mark.asyncio
async def test_list_sessions(client):
    async with client as c:
        await c.post("/api/chat/sessions")
        resp = await c.get("/api/chat/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert "sessions" in data
    assert "total" in data


@pytest.mark.asyncio
async def test_rename_session(client):
    async with client as c:
        create_resp = await c.post("/api/chat/sessions")
        sid = create_resp.json()["session_id"]
        resp = await c.patch(f"/api/chat/sessions/{sid}", json={"title": "My Session"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "My Session"


@pytest.mark.asyncio
async def test_rename_nonexistent_session_returns_404(client):
    async with client as c:
        resp = await c.patch("/api/chat/sessions/ghost-999", json={"title": "X"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_session(client):
    async with client as c:
        create_resp = await c.post("/api/chat/sessions")
        sid = create_resp.json()["session_id"]
        resp = await c.delete(f"/api/chat/sessions/{sid}")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_nonexistent_session_returns_404(client):
    async with client as c:
        resp = await c.delete("/api/chat/sessions/ghost-000")
    assert resp.status_code == 404


# ── SSE response headers ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_sse_response_headers(client):
    """POST /api/chat/ must return text/event-stream with correct cache headers."""

    async def fake_stream(*args, **kwargs):
        yield {"type": "token", "text": "hi"}

    with patch("api.routes.chat.ChatEngine") as MockEngine:
        instance = MagicMock()
        instance.stream_response = fake_stream
        MockEngine.return_value = instance

        async with client as c:
            resp = await c.post(
                "/api/chat/",
                json={"message": "hello"},
                headers={"x-session-id": "test-sse", "x-mode": "chat"},
            )

    assert "text/event-stream" in resp.headers.get("content-type", "")
    assert resp.headers.get("cache-control") == "no-cache"
    assert resp.headers.get("x-accel-buffering") == "no"


# ── malformed request ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_malformed_attachments_returns_422(client):
    """attachments field with wrong type should be rejected with HTTP 422."""
    async with client as c:
        resp = await c.post(
            "/api/chat/",
            json={"message": "hello", "attachments": "not-a-list"},
            headers={"x-session-id": "test-422", "x-mode": "chat"},
        )
    assert resp.status_code == 422


# ── done event always emitted ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_stream_always_ends_with_done_frame(client):
    """The SSE route must always append a `done` frame after the engine finishes."""

    async def fake_stream(*args, **kwargs):
        yield {"type": "token", "text": "hello"}

    with patch("api.routes.chat.ChatEngine") as MockEngine:
        instance = MagicMock()
        instance.stream_response = fake_stream
        MockEngine.return_value = instance

        async with client as c:
            resp = await c.post(
                "/api/chat/",
                json={"message": "hi"},
                headers={"x-session-id": "done-test", "x-mode": "chat"},
            )

    assert "event: done" in resp.text


# ── message pagination endpoint ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_messages_returns_empty_for_new_session(client):
    async with client as c:
        create_resp = await c.post("/api/chat/sessions")
        sid = create_resp.json()["session_id"]
        resp = await c.get(f"/api/chat/sessions/{sid}/messages")
    assert resp.status_code == 200
    data = resp.json()
    assert data["messages"] == []
    assert data["has_more"] is False
