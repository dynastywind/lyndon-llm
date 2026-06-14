"""Unit tests for the LLM-driven intent orchestrator.

The classifier's single LLM call (``llm_gateway.complete``) is monkeypatched so
these tests are deterministic and never touch a real model.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from chat.orchestrator import LLMOrchestrator
from core.llm.gateway import LLMUsage


def _patch_complete(monkeypatch, *, intent=None, raw=None, raises=None):
    """Patch llm_gateway.complete to return canned classifier output.

    Pass ``intent`` for a well-formed JSON response, ``raw`` for an arbitrary
    string body, or ``raises`` to simulate a failure (timeout / connection).
    """

    async def fake_complete(*args, **kwargs):
        if raises is not None:
            raise raises
        body = raw if raw is not None else json.dumps({"intent": intent, "reason": "because"})
        return body, LLMUsage()

    monkeypatch.setattr("chat.orchestrator.llm_gateway.complete", fake_complete)


@pytest.fixture
def orchestrator() -> LLMOrchestrator:
    return LLMOrchestrator()


# ── intent → route mapping ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_casual_maps_to_direct(monkeypatch, orchestrator):
    _patch_complete(monkeypatch, intent="casual")
    decision = await orchestrator.route("how's it going?", has_kb_sources=False)
    assert decision.route == "direct"
    assert decision.tools == frozenset()


@pytest.mark.asyncio
async def test_factual_maps_to_web_search_fast_path(monkeypatch, orchestrator):
    _patch_complete(monkeypatch, intent="factual")
    decision = await orchestrator.route("weather in Sydney right now?", has_kb_sources=False)
    assert decision.route == "tools"
    # Single-tool set so the engine takes the web-search fast path.
    assert decision.tools == frozenset({"web_search"})


@pytest.mark.asyncio
async def test_complex_maps_to_plan(monkeypatch, orchestrator):
    _patch_complete(monkeypatch, intent="complex")
    decision = await orchestrator.route(
        "research vector DBs, compare them, and chart it", has_kb_sources=False
    )
    assert decision.route == "plan"


@pytest.mark.asyncio
async def test_documents_maps_to_rag_only_when_kb_present(monkeypatch, orchestrator):
    _patch_complete(monkeypatch, intent="documents")
    decision = await orchestrator.route("summarize my report", has_kb_sources=True)
    assert decision.route == "rag"


@pytest.mark.asyncio
async def test_documents_without_kb_falls_back_to_direct(monkeypatch, orchestrator):
    """If the model returns 'documents' but there is no KB, never route to rag."""
    _patch_complete(monkeypatch, intent="documents")
    decision = await orchestrator.route("summarize my report", has_kb_sources=False)
    assert decision.route == "direct"


@pytest.mark.asyncio
async def test_complex_downgrades_when_planner_disabled(monkeypatch, orchestrator):
    _patch_complete(monkeypatch, intent="complex")
    monkeypatch.setattr("chat.orchestrator.settings.planner_enabled", False)
    decision = await orchestrator.route(
        "research vector DBs, compare them, and chart it", has_kb_sources=False
    )
    # Planner disabled → must not return a plan; heuristic handles it instead.
    assert decision.route != "plan"
    assert decision.route in ("direct", "rag", "tools", "rag_and_tools")


# ── fallback behaviour ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_empty_message_short_circuits_without_llm_call(monkeypatch, orchestrator):
    async def boom(*args, **kwargs):  # pragma: no cover - must not be called
        raise AssertionError("LLM should not be called for an empty message")

    monkeypatch.setattr("chat.orchestrator.llm_gateway.complete", boom)
    decision = await orchestrator.route("   ", has_kb_sources=False)
    assert decision.route == "direct"


@pytest.mark.asyncio
async def test_classifier_exception_falls_back_to_heuristic(monkeypatch, orchestrator):
    _patch_complete(monkeypatch, raises=ConnectionError("LLM down"))
    # A clear web-search query → heuristic should route it to the web_search tool.
    decision = await orchestrator.route(
        "what's the latest news about OpenAI", has_kb_sources=False
    )
    assert decision.route == "tools"
    assert decision.tools == frozenset({"web_search"})


@pytest.mark.asyncio
async def test_timeout_falls_back_to_heuristic(monkeypatch, orchestrator):
    _patch_complete(monkeypatch, raises=TimeoutError())
    decision = await orchestrator.route("hello there", has_kb_sources=False)
    # Heuristic classifies a short greeting as direct.
    assert decision.route == "direct"


@pytest.mark.asyncio
async def test_malformed_json_falls_back_to_heuristic(monkeypatch, orchestrator):
    _patch_complete(monkeypatch, raw="this is not json at all")
    decision = await orchestrator.route(
        "what's the latest news about OpenAI", has_kb_sources=False
    )
    assert decision.route == "tools"
    assert decision.tools == frozenset({"web_search"})


@pytest.mark.asyncio
async def test_unknown_intent_falls_back_to_heuristic(monkeypatch, orchestrator):
    _patch_complete(monkeypatch, intent="banana")
    decision = await orchestrator.route("hello there", has_kb_sources=False)
    assert decision.route == "direct"


@pytest.mark.asyncio
async def test_json_with_code_fence_is_parsed(monkeypatch, orchestrator):
    _patch_complete(
        monkeypatch,
        raw='```json\n{"intent": "factual", "reason": "live data"}\n```',
    )
    decision = await orchestrator.route("current btc price?", has_kb_sources=False)
    assert decision.route == "tools"
    assert decision.tools == frozenset({"web_search"})
