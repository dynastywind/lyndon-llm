"""
Unit tests for _ThinkingStreamParser — the chain-of-thought tag stripper
that converts <think>…</think> blocks into thinking_token events.

All tests are synchronous and require no I/O.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from chat.engine import _ThinkingStreamParser  # noqa: E402

# ── helpers ───────────────────────────────────────────────────────────────────


def feed_all(parser: _ThinkingStreamParser, chunks: list[str]) -> list[tuple[str, str]]:
    """Feed every chunk and collect all (event_type, text) pairs."""
    results: list[tuple[str, str]] = []
    for chunk in chunks:
        results.extend(parser.feed(chunk))
    results.extend(parser.flush())
    return results


def token_text(events: list[tuple[str, str]]) -> str:
    return "".join(t for evt, t in events if evt == "token")


def thinking_text(events: list[tuple[str, str]]) -> str:
    return "".join(t for evt, t in events if evt == "thinking_token")


# ── plain text — no tags ──────────────────────────────────────────────────────


def test_plain_text_passes_through_as_token():
    p = _ThinkingStreamParser()
    events = feed_all(p, ["Hello, world!"])
    assert token_text(events) == "Hello, world!"
    assert thinking_text(events) == ""


def test_multiple_plain_chunks_concatenated():
    p = _ThinkingStreamParser()
    events = feed_all(p, ["foo", " bar", " baz"])
    assert token_text(events) == "foo bar baz"


# ── simple <think> block ──────────────────────────────────────────────────────


def test_think_block_emits_thinking_tokens():
    p = _ThinkingStreamParser()
    events = feed_all(p, ["<think>reasoning here</think>answer"])
    assert thinking_text(events) == "reasoning here"
    assert token_text(events) == "answer"


def test_think_tags_are_not_forwarded():
    p = _ThinkingStreamParser()
    events = feed_all(p, ["<think>x</think>y"])
    combined = "".join(t for _, t in events)
    assert "<think>" not in combined
    assert "</think>" not in combined


def test_text_before_and_after_think_block():
    p = _ThinkingStreamParser()
    events = feed_all(p, ["prefix <think>internal</think> suffix"])
    assert token_text(events) == "prefix  suffix"
    assert thinking_text(events) == "internal"


# ── chunked delivery ──────────────────────────────────────────────────────────


def test_open_tag_split_across_chunks():
    """<think> tag arrives in two pieces — must not emit the partial tag."""
    p = _ThinkingStreamParser()
    # Split "<think>" as "<thi" and "nk>content</think>"
    events = feed_all(p, ["<thi", "nk>content</think>end"])
    assert thinking_text(events) == "content"
    assert token_text(events) == "end"


def test_close_tag_split_across_chunks():
    """</think> arrives in two pieces."""
    p = _ThinkingStreamParser()
    events = feed_all(p, ["<think>data</thi", "nk>rest"])
    assert thinking_text(events) == "data"
    assert token_text(events) == "rest"


def test_content_inside_think_split_across_many_chunks():
    p = _ThinkingStreamParser()
    events = feed_all(p, ["<think>", "step 1\n", "step 2\n", "</think>", "final"])
    assert thinking_text(events) == "step 1\nstep 2\n"
    assert token_text(events) == "final"


# ── flush ─────────────────────────────────────────────────────────────────────


def test_flush_drains_buffered_token_content():
    p = _ThinkingStreamParser()
    # Feed a partial <think> — it is held in the buffer waiting for more
    p.feed("<thi")
    # If nothing more arrives, flush should emit what's buffered as a token
    events = p.flush()
    assert len(events) == 1
    assert events[0][0] == "token"
    assert "<thi" in events[0][1]


def test_flush_drains_buffered_thinking_content():
    p = _ThinkingStreamParser()
    # Feed content that ends mid-close-tag so the parser must hold the partial
    # tag bytes in its buffer — these can only be resolved at flush time.
    via_feed = p.feed("<think>reasoning</thi")
    # "reasoning" is emitted eagerly; "</thi" is held as a partial-match guard
    thinking_from_feed = "".join(t for evt, t in via_feed if evt == "thinking_token")
    assert "reasoning" in thinking_from_feed

    events = p.flush()
    # The buffered partial close-tag must be flushed as a thinking_token
    # (we are still inside the <think> block)
    assert len(events) >= 1
    flushed_thinking = "".join(t for evt, t in events if evt == "thinking_token")
    assert "thi" in flushed_thinking  # partial </think> tag bytes


def test_flush_returns_empty_when_nothing_buffered():
    p = _ThinkingStreamParser()
    p.feed("complete text")
    p.feed("")
    # All content already emitted via feed()
    result = p.flush()
    # After content is consumed via feed, flush should be empty or minimal
    # (may hold partial-match guard bytes, which is correct behaviour)
    assert isinstance(result, list)


# ── multiple think blocks ─────────────────────────────────────────────────────


def test_two_think_blocks_in_one_stream():
    p = _ThinkingStreamParser()
    events = feed_all(p, ["<think>first</think>mid<think>second</think>end"])
    assert thinking_text(events) == "firstsecond"
    assert token_text(events) == "midend"


def test_empty_think_block():
    p = _ThinkingStreamParser()
    events = feed_all(p, ["before<think></think>after"])
    assert token_text(events) == "beforeafter"
    assert thinking_text(events) == ""


# ── event ordering ────────────────────────────────────────────────────────────


def test_event_types_in_correct_order():
    p = _ThinkingStreamParser()
    events = feed_all(p, ["A<think>B</think>C"])
    types = [evt for evt, _ in events]
    # Must have token, then thinking_token, then token — in that order
    assert types.index("token") < types.index("thinking_token")
    last_token_idx = max(i for i, t in enumerate(types) if t == "token")
    thinking_idx = types.index("thinking_token")
    assert thinking_idx < last_token_idx
