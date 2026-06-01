"""
Regression tests for core/llm/gateway.py.

Covers:
  - LLMUsage arithmetic (mutation semantics, total_tokens, to_dict)
  - stream_from_raw: LLMUsage sentinel always yielded at the end
  - stream_from_raw: usage captured from final chunk, zero when absent
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── LLMUsage ──────────────────────────────────────────────────────────────────


def test_llm_usage_iadd_mutates_in_place():
    """__iadd__ must mutate self and return the same object, not a copy."""
    from core.llm.gateway import LLMUsage

    u = LLMUsage(prompt_tokens=10, completion_tokens=20)
    original_id = id(u)
    u += LLMUsage(prompt_tokens=5, completion_tokens=15)

    assert id(u) == original_id, "__iadd__ must return self, not a new object"
    assert u.prompt_tokens == 15
    assert u.completion_tokens == 35


def test_llm_usage_iadd_accumulates_multiple_additions():
    """Repeated += accumulate correctly without resetting to zero."""
    from core.llm.gateway import LLMUsage

    total = LLMUsage()
    for i in range(1, 6):
        total += LLMUsage(prompt_tokens=i, completion_tokens=i * 2)

    assert total.prompt_tokens == 15    # 1+2+3+4+5
    assert total.completion_tokens == 30  # 2+4+6+8+10


def test_llm_usage_total_tokens():
    from core.llm.gateway import LLMUsage

    u = LLMUsage(prompt_tokens=100, completion_tokens=50)
    assert u.total_tokens == 150


def test_llm_usage_to_dict():
    from core.llm.gateway import LLMUsage

    u = LLMUsage(prompt_tokens=7, completion_tokens=3)
    d = u.to_dict()
    assert d == {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10}


def test_llm_usage_zero_default():
    from core.llm.gateway import LLMUsage

    u = LLMUsage()
    assert u.prompt_tokens == 0
    assert u.completion_tokens == 0
    assert u.total_tokens == 0


def test_llm_usage_iadd_with_zeros():
    """Adding a zero-usage object must not alter the accumulator."""
    from core.llm.gateway import LLMUsage

    u = LLMUsage(prompt_tokens=100, completion_tokens=200)
    u += LLMUsage()
    assert u.prompt_tokens == 100
    assert u.completion_tokens == 200


# ── stream_from_raw: LLMUsage sentinel ────────────────────────────────────────


@pytest.mark.asyncio
async def test_stream_from_raw_always_yields_usage_sentinel(monkeypatch):
    """
    stream_from_raw must always yield an LLMUsage as its final item,
    even when the upstream API returns usage=None on every chunk.
    """
    from unittest.mock import AsyncMock, MagicMock, patch

    from core.llm.gateway import LLMUsage, llm_gateway

    # Build fake streaming chunks with no usage info
    def _make_chunk(text: str):
        chunk = MagicMock()
        chunk.usage = None
        chunk.choices = [MagicMock()]
        chunk.choices[0].delta.content = text
        return chunk

    fake_response = AsyncMock()
    fake_response.__aiter__ = lambda self: aiter_from_list(
        [_make_chunk("Hello"), _make_chunk(" world")]
    )

    async def aiter_from_list(items):
        for item in items:
            yield item

    fake_response.__aiter__ = lambda self: aiter_from_list(
        [_make_chunk("Hello"), _make_chunk(" world")]
    )

    with patch.object(llm_gateway._client.chat.completions, "create", new=AsyncMock(return_value=fake_response)):
        items = []
        async for item in llm_gateway.stream_from_raw([{"role": "user", "content": "hi"}]):
            items.append(item)

    assert items, "stream_from_raw yielded nothing"
    last = items[-1]
    assert isinstance(last, LLMUsage), (
        f"Last item must be LLMUsage sentinel, got {type(last).__name__}"
    )


@pytest.mark.asyncio
async def test_stream_from_raw_captures_usage_from_final_chunk(monkeypatch):
    """Usage fields are taken from the chunk that contains usage data."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from core.llm.gateway import LLMUsage, llm_gateway

    def _make_chunk(text: str | None, prompt: int = 0, completion: int = 0):
        chunk = MagicMock()
        if prompt or completion:
            chunk.usage = MagicMock()
            chunk.usage.prompt_tokens = prompt
            chunk.usage.completion_tokens = completion
        else:
            chunk.usage = None
        chunk.choices = [MagicMock()] if text is not None else []
        if text is not None:
            chunk.choices[0].delta.content = text
        return chunk

    async def aiter_chunks(items):
        for item in items:
            yield item

    # Typical pattern: content chunks then a final usage-only chunk
    chunks = [
        _make_chunk("Hello"),
        _make_chunk(" world"),
        _make_chunk(None, prompt=10, completion=5),  # usage-only, no content
    ]
    fake_response = MagicMock()
    fake_response.__aiter__ = lambda self: aiter_chunks(chunks)

    with patch.object(
        llm_gateway._client.chat.completions, "create", new=AsyncMock(return_value=fake_response)
    ):
        items = []
        async for item in llm_gateway.stream_from_raw([{"role": "user", "content": "hi"}]):
            items.append(item)

    usage = items[-1]
    assert isinstance(usage, LLMUsage)
    assert usage.prompt_tokens == 10
    assert usage.completion_tokens == 5


@pytest.mark.asyncio
async def test_stream_from_raw_text_chunks_before_usage(monkeypatch):
    """All non-LLMUsage items yielded before the sentinel must be strings."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from core.llm.gateway import LLMUsage, llm_gateway

    def _make_chunk(text):
        chunk = MagicMock()
        chunk.usage = None
        chunk.choices = [MagicMock()]
        chunk.choices[0].delta.content = text
        return chunk

    async def aiter_chunks(items):
        for item in items:
            yield item

    chunks = [_make_chunk("a"), _make_chunk("b"), _make_chunk("c")]
    fake_response = MagicMock()
    fake_response.__aiter__ = lambda self: aiter_chunks(chunks)

    with patch.object(
        llm_gateway._client.chat.completions, "create", new=AsyncMock(return_value=fake_response)
    ):
        items = []
        async for item in llm_gateway.stream_from_raw([{"role": "user", "content": "hi"}]):
            items.append(item)

    text_items = [i for i in items if not isinstance(i, LLMUsage)]
    assert all(isinstance(t, str) for t in text_items), (
        "All non-sentinel items must be strings"
    )
    assert "".join(text_items) == "abc"
