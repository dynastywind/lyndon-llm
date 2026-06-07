"""
HTTP contract tests for per-user assistant settings on /api/auth/me.

Confirms the system prompt + profession are server-scoped per account: a new
user starts with none, updates persist, and one user never sees another's
settings. Uses an in-memory SQLite DB — no real LLM or network.
"""

from __future__ import annotations

import os
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


@pytest_asyncio.fixture(scope="module")
async def app():
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from api.routes.auth import router as auth_router
    import db.base as db_base
    import db.models.user  # noqa: F401 — register model before create_all

    _app = FastAPI()
    _app.include_router(auth_router, prefix="/api/auth")

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


async def _register(c, username: str) -> str:
    resp = await c.post("/api/auth/register", json={"username": username, "password": "pw-123456"})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_new_user_has_no_settings(client):
    async with client as c:
        token = await _register(c, "alice")
        me = (await c.get("/api/auth/me", headers=_auth(token))).json()
    assert me["username"] == "alice"
    assert me["system_prompt"] is None
    assert me["profession"] is None


@pytest.mark.asyncio
async def test_update_and_read_back_settings(client):
    async with client as c:
        token = await _register(c, "bob")
        patch = await c.patch(
            "/api/auth/me",
            headers=_auth(token),
            json={"system_prompt": "My name is Bob.", "profession": "Engineer"},
        )
        assert patch.status_code == 200
        me = (await c.get("/api/auth/me", headers=_auth(token))).json()
    assert me["system_prompt"] == "My name is Bob."
    assert me["profession"] == "Engineer"


@pytest.mark.asyncio
async def test_settings_are_isolated_per_user(client):
    async with client as c:
        tok_a = await _register(c, "carol")
        await c.patch(
            "/api/auth/me",
            headers=_auth(tok_a),
            json={"system_prompt": "I am Carol the doctor."},
        )
        # A brand-new second account must NOT see Carol's prompt.
        tok_b = await _register(c, "dave")
        me_b = (await c.get("/api/auth/me", headers=_auth(tok_b))).json()
    assert me_b["system_prompt"] is None
    assert me_b["profession"] is None


@pytest.mark.asyncio
async def test_partial_update_does_not_clobber_other_field(client):
    async with client as c:
        token = await _register(c, "erin")
        await c.patch(
            "/api/auth/me",
            headers=_auth(token),
            json={"system_prompt": "Keep me", "profession": "Artist"},
        )
        # Update only profession; system_prompt must survive.
        await c.patch("/api/auth/me", headers=_auth(token), json={"profession": "Painter"})
        me = (await c.get("/api/auth/me", headers=_auth(token))).json()
    assert me["system_prompt"] == "Keep me"
    assert me["profession"] == "Painter"
