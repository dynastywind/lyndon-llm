"""Tests for the in-memory SessionManager."""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import UTC, datetime, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture
def manager():
    from core.session.manager import SessionManager

    return SessionManager()


# ── basic create / get ────────────────────────────────────────────────────────


def test_create_returns_unique_ids(manager):
    from core.permissions.gate import Mode

    ids = {manager.create(mode=Mode.CHAT).session_id for _ in range(20)}
    assert len(ids) == 20, "All session IDs must be unique"


def test_get_existing_session(manager):
    from core.permissions.gate import Mode

    session = manager.create(Mode.CHAT)
    retrieved = manager.get(session.session_id)
    assert retrieved is not None
    assert retrieved.session_id == session.session_id


def test_get_nonexistent_returns_none(manager):
    assert manager.get("does-not-exist") is None


# ── TTL eviction ──────────────────────────────────────────────────────────────


def test_ttl_evicts_expired_session(manager, monkeypatch):
    from core.permissions.gate import Mode

    session = manager.create(Mode.CHAT)
    sid = session.session_id

    # Wind the clock forward past TTL
    expired_time = datetime.now(UTC) - timedelta(seconds=999_999)
    session.last_active = expired_time

    result = manager.get(sid)
    assert result is None, "Expired session should be evicted and return None"
    # Should also be removed from the internal dict
    assert sid not in manager._sessions


# ── get_or_create ─────────────────────────────────────────────────────────────


def test_get_or_create_returns_same_session(manager):
    from core.permissions.gate import Mode

    s = manager.create(Mode.CHAT)
    s2 = manager.get_or_create(s.session_id, mode=Mode.CHAT)
    assert s.session_id == s2.session_id


def test_get_or_create_with_none_creates_new(manager):
    from core.permissions.gate import Mode

    s = manager.get_or_create(None, mode=Mode.CHAT)
    assert s is not None
    assert s.session_id


def test_get_or_create_rebuilds_after_ttl(manager, monkeypatch):
    """After TTL expiry, get_or_create should rebuild the session with the same ID."""
    from core.permissions.gate import Mode

    session = manager.create(Mode.CHAT)
    sid = session.session_id
    session.last_active = datetime.now(UTC) - timedelta(seconds=999_999)

    rebuilt = manager.get_or_create(sid, mode=Mode.CHAT)
    assert rebuilt.session_id == sid
    assert not rebuilt.is_expired()


# ── concurrent creation ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_concurrent_session_creation_no_collisions(manager):
    from core.permissions.gate import Mode

    async def create_one():
        return manager.create(Mode.CHAT).session_id

    results = await asyncio.gather(*[create_one() for _ in range(50)])
    assert len(results) == len(set(results)), "IDs should be unique under concurrent creation"


# ── destroy ───────────────────────────────────────────────────────────────────


def test_destroy_removes_session(manager):
    from core.permissions.gate import Mode

    s = manager.create(Mode.CHAT)
    manager.destroy(s.session_id)
    assert manager.get(s.session_id) is None


def test_destroy_nonexistent_is_safe(manager):
    manager.destroy("ghost-session")  # Should not raise


# ── purge_expired ─────────────────────────────────────────────────────────────


def test_purge_expired_removes_stale_sessions(manager):
    from core.permissions.gate import Mode

    alive = manager.create(Mode.CHAT)
    dead = manager.create(Mode.CHAT)
    dead.last_active = datetime.now(UTC) - timedelta(seconds=999_999)

    removed = manager.purge_expired()
    assert removed == 1
    assert manager.get(alive.session_id) is not None
    assert dead.session_id not in manager._sessions
