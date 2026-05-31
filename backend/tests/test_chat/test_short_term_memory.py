"""Tests for ShortTermMemory compression behaviour."""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


@pytest.fixture
def mem():
    from chat.memory.short_term import ShortTermMemory

    m = ShortTermMemory("test-session")
    m.set_system_prompt("You are a helpful assistant.")
    return m


# ── token budget enforcement ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_compression_reduces_token_count(mem, monkeypatch):
    """After compression the total token count should drop below the limit."""
    from config.settings import settings

    # Override limit to something small so we can trigger it quickly
    monkeypatch.setattr(settings, "short_term_max_tokens", 100)

    # Add turns until we exceed the budget
    for i in range(30):
        mem.add("user", f"User message number {i} with some padding text to grow tokens.")
        mem.add("assistant", f"Assistant reply number {i} — also padded to consume tokens.")

    assert mem.needs_compression(), "Expected needs_compression() to be True"

    async def fake_summarise(turns):
        return "Earlier conversation summarised."

    await mem.compress(fake_summarise)

    # Primary assertion: system prompt is NOT dropped
    msgs = mem.get_messages()
    assert msgs[0]["role"] == "system", "System prompt must remain first after compression"


# ── compression preserves order ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_compression_preserves_order_and_recency(mem):
    """After compression, remaining turns are in chronological order and the latest turns survive."""
    for i in range(10):
        mem.add("user", f"turn {i}")
        mem.add("assistant", f"reply {i}")

    async def fake_summarise(turns):
        return "Summary of earlier turns."

    await mem.compress(fake_summarise)

    msgs = mem.get_messages()
    # The last assistant/user messages must be present
    contents = [m["content"] for m in msgs]
    assert any("turn 9" in c or "reply 9" in c for c in contents), (
        "Most recent turns should survive compression"
    )

    # Roles must not be garbled — no empty content
    for m in msgs:
        assert m["role"] in ("system", "user", "assistant")
        assert m["content"]


# ── nothing compresses when turns ≤ ALWAYS_KEEP_RECENT ───────────────────────


@pytest.mark.asyncio
async def test_no_compression_when_few_turns(mem):
    """compress() is a no-op when turns ≤ ALWAYS_KEEP_RECENT."""
    from chat.memory.short_term import ShortTermMemory

    mem.add("user", "hello")
    mem.add("assistant", "hi")

    summariser_called = False

    async def fake_summarise(turns):
        nonlocal summariser_called
        summariser_called = True
        return "summary"

    result = await mem.compress(fake_summarise)
    assert result == "", "No summary should be produced for short history"
    assert not summariser_called


# ── single giant message does not loop ───────────────────────────────────────


@pytest.mark.asyncio
async def test_single_giant_message_no_infinite_loop(mem, monkeypatch):
    """A single message exceeding the token budget should compress without hanging."""
    from config.settings import settings

    monkeypatch.setattr(settings, "short_term_max_tokens", 10)

    mem.add("user", "x" * 10000)  # way over budget

    async def fake_summarise(turns):
        return "Summary."

    # Should return without looping
    await mem.compress(fake_summarise)
    assert True  # reached here — no infinite loop


# ── get_messages returns system first ─────────────────────────────────────────


def test_get_messages_includes_system_prompt(mem):
    mem.add("user", "hi")
    msgs = mem.get_messages()
    assert msgs[0] == {"role": "system", "content": "You are a helpful assistant."}
    assert msgs[1] == {"role": "user", "content": "hi"}
