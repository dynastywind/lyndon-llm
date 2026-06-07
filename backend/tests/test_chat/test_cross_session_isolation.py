"""Tests for per-user memory isolation.

Covers the two leak vectors fixed in the memory system:
  1. CrossSessionFileMemory must be keyed by user_id (no global shared file),
     and disabled entirely for anonymous (user_id=None) sessions.
  2. LongTermMemory.retrieve must never run an unscoped query (which would
     return every user's episodic memories).
"""

from __future__ import annotations

import pytest

# --------------------------------------------------------------------------- #
#  CrossSessionFileMemory — per-user file isolation                            #
# --------------------------------------------------------------------------- #


def test_cross_session_files_are_isolated_per_user(tmp_path, monkeypatch):
    from chat.memory import cross_session_file as csf
    from config.settings import settings

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))

    mem_a = csf.CrossSessionFileMemory("user-A")
    mem_b = csf.CrossSessionFileMemory("user-B")

    # Distinct files on disk.
    assert mem_a._path != mem_b._path

    mem_a.save("## User Profile\n- Gender: Male\n\n## Key Facts\n- Likes coffee")

    # B must NOT see A's profile.
    assert mem_b.load() is None
    assert mem_b.load_sections() is None
    # A round-trips its own data.
    assert "Gender: Male" in (mem_a.load() or "")


def test_cross_session_disabled_for_anonymous(tmp_path, monkeypatch):
    from chat.memory import cross_session_file as csf
    from config.settings import settings

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))

    anon = csf.CrossSessionFileMemory(None)
    assert anon.enabled is False
    assert anon.load() is None
    assert anon.load_sections() is None

    # save() is a no-op — nothing is written, no exception raised.
    anon.save("## User Profile\n- Gender: Male")
    assert list(tmp_path.glob("*.md")) == []


@pytest.mark.asyncio
async def test_cross_session_update_disabled_for_anonymous(tmp_path, monkeypatch):
    from chat.memory import cross_session_file as csf
    from config.settings import settings

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))

    called = False

    async def _fake_llm(messages):  # pragma: no cover - must never run
        nonlocal called
        called = True
        return "## User Profile\n- Gender: Male"

    anon = csf.CrossSessionFileMemory(None)
    result = await anon.update("## User Profile\n- Gender: Male", _fake_llm)

    assert result == ""
    assert called is False  # no LLM call for anonymous
    assert list(tmp_path.glob("*.md")) == []


# --------------------------------------------------------------------------- #
#  LongTermMemory.retrieve — refuse unscoped (cross-user) queries              #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_retrieve_refuses_unscoped_query(monkeypatch):
    """No user_id and no session_id must return [] without touching the store."""
    from chat.memory.long_term import LongTermMemory

    lt = LongTermMemory()

    async def _boom(*args, **kwargs):  # pragma: no cover - must never run
        raise AssertionError("vector store must not be queried for unscoped retrieve")

    monkeypatch.setattr(LongTermMemory, "_get_vector_store", _boom)

    result = await lt.retrieve("anything")  # no user_id, no session_id
    assert result == []


@pytest.mark.asyncio
async def test_retrieve_scoped_by_session_is_allowed(monkeypatch):
    """A session_id alone is a valid scope (used for anonymous sessions)."""
    from chat.memory.long_term import LongTermMemory
    from core.llm import gateway as gw

    captured: dict = {}

    class _FakeVS:
        async def query(self, query_embeddings, n_results=5, where=None):
            captured["where"] = where
            return {"documents": [[]], "metadatas": [[]], "distances": [[]]}

    async def _fake_get_vs(self):
        return _FakeVS()

    async def _fake_embed(texts):
        return [[0.0, 0.1, 0.2]]

    monkeypatch.setattr(LongTermMemory, "_get_vector_store", _fake_get_vs)
    monkeypatch.setattr(gw.llm_gateway, "embed", _fake_embed)

    lt = LongTermMemory()
    result = await lt.retrieve("hi", session_id="sess-1")
    assert result == []
    assert captured["where"] == {"session_id": "sess-1"}


# --------------------------------------------------------------------------- #
#  MemoryManager — episodic retrieval is always scoped                          #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_anonymous_manager_scopes_episodic_to_session(monkeypatch, tmp_path):
    from chat.memory import cross_session_file as csf
    from chat.memory.long_term import LongTermMemory
    from chat.memory.manager import MemoryManager
    from chat.memory.session_file import SessionFileMemory
    from config.settings import settings

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))
    monkeypatch.setattr(csf.CrossSessionFileMemory, "load", lambda self: None)
    monkeypatch.setattr(SessionFileMemory, "load", lambda self, sid: None)

    captured: dict = {}

    async def _capture_retrieve(self, query, top_k=None, user_id=None, session_id=None, **kw):
        captured["user_id"] = user_id
        captured["session_id"] = session_id
        return []

    monkeypatch.setattr(LongTermMemory, "retrieve", _capture_retrieve)

    # Anonymous: falls back to session scoping.
    mgr = MemoryManager("sess-xyz", user_id=None)
    await mgr.build_system_prompt("base", "question")
    assert captured == {"user_id": None, "session_id": "sess-xyz"}

    # Logged-in: scoped by user_id, no session fallback.
    mgr2 = MemoryManager("sess-xyz", user_id="user-A")
    await mgr2.build_system_prompt("base", "question")
    assert captured == {"user_id": "user-A", "session_id": None}


@pytest.mark.asyncio
async def test_prompt_has_exactly_one_user_profile(monkeypatch, tmp_path):
    """Episodic memories are whole session snapshots that each contain a
    '## User Profile'. The assembled prompt must still carry exactly ONE."""
    from chat.memory import cross_session_file as csf
    from chat.memory.long_term import LongTermMemory
    from chat.memory.manager import MemoryManager
    from chat.memory.session_file import SessionFileMemory
    from chat.memory.types import Memory, MemoryType
    from config.settings import settings

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))
    # Cross-session profile (authoritative, merged once).
    monkeypatch.setattr(
        csf.CrossSessionFileMemory,
        "load_sections",
        lambda self: "## User Profile\n- Gender: Male\n\n## Key Facts\n- Likes coffee",
    )
    monkeypatch.setattr(
        SessionFileMemory,
        "load",
        lambda self, sid: "## Conversation Summary\nDiscussed travel.\n\n## User Profile\n- Age: 30",
    )

    # Two retrieved episodic memories, each a full session-file snapshot.
    snapshot = (
        "# Session Memory: s\nUpdated: x\n\n"
        "## Conversation Summary\nUser asked about Python.\n\n"
        "## User Profile\n- Age: 30\n- Gender: Male"
    )

    async def _retrieve(self, query, top_k=None, user_id=None, session_id=None, **kw):
        return [
            Memory(session_id="s1", memory_type=MemoryType.EPISODIC, content=snapshot),
            Memory(session_id="s2", memory_type=MemoryType.EPISODIC, content=snapshot),
        ]

    monkeypatch.setattr(LongTermMemory, "retrieve", _retrieve)

    mgr = MemoryManager("sess-xyz", user_id="user-A")
    prompt = await mgr.build_system_prompt("base", "tell me about python")

    assert prompt.count("## User Profile") == 1
    # The conversational substance of the episodic memories still made it in.
    assert "User asked about Python." in prompt
    assert "## Relevant memories from past sessions" in prompt
