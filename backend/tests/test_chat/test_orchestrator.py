"""Unit tests for heuristic chat message orchestrator."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from chat.orchestrator import HeuristicOrchestrator, RouteDecision


@pytest.fixture
def orchestrator() -> HeuristicOrchestrator:
    return HeuristicOrchestrator()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "message,has_kb,expected_route,expected_tools",
    [
        ("hello", False, "direct", frozenset()),
        ("thanks!", False, "direct", frozenset()),
        (
            "summarize my uploaded PDF",
            True,
            "rag",
            frozenset(),
        ),
        (
            "what does the document say about revenue?",
            True,
            "rag",
            frozenset(),
        ),
        (
            "what's the weather in NYC today",
            False,
            "tools",
            frozenset({"web_search"}),
        ),
        (
            "plot quarterly sales",
            False,
            "tools",
            frozenset({"render_chart"}),
        ),
        (
            "chart revenue from my financial report",
            True,
            "rag_and_tools",
            frozenset({"render_chart", "rag_query"}),
        ),
        (
            "explain recursion in Python",
            False,
            "direct",
            frozenset(),
        ),
        (
            "latest news about OpenAI",
            False,
            "tools",
            frozenset({"web_search"}),
        ),
    ],
)
async def test_heuristic_routing(
    orchestrator: HeuristicOrchestrator,
    message: str,
    has_kb: bool,
    expected_route: str,
    expected_tools: frozenset[str],
) -> None:
    decision = await orchestrator.route(message, has_kb_sources=has_kb)
    assert decision.route == expected_route
    assert decision.tools == expected_tools


@pytest.mark.asyncio
async def test_rag_signal_ignored_when_kb_empty_without_explicit_doc(
    orchestrator: HeuristicOrchestrator,
) -> None:
    """Generic doc language without explicit upload mention → direct if KB empty."""
    decision = await orchestrator.route(
        "what does the document say about revenue?",
        has_kb_sources=False,
    )
    assert decision.route == "direct"


@pytest.mark.asyncio
async def test_explicit_doc_triggers_rag_without_kb(
    orchestrator: HeuristicOrchestrator,
) -> None:
    decision = await orchestrator.route(
        "summarize my uploaded PDF",
        has_kb_sources=False,
    )
    assert decision.route == "rag"


@pytest.mark.asyncio
async def test_route_decision_properties() -> None:
    d = RouteDecision("rag_and_tools", frozenset({"web_search"}), "test")
    assert d.needs_rag is True
    assert d.needs_tools is True

    d2 = RouteDecision("direct", frozenset(), "test")
    assert d2.needs_rag is False
    assert d2.needs_tools is False
