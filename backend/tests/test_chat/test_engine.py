"""
Tests for ChatEngine SSE stream integrity.

All LLM / tool calls are mocked so no real network is needed.
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_engine(session_id: str = "test-session"):

    from chat.engine import ChatEngine
    from core.permissions.gate import Mode
    from core.session.manager import Session

    session = Session(session_id=session_id, mode=Mode.CHAT)
    engine = ChatEngine(session, db=None)
    return engine


async def _collect(gen) -> list[dict]:
    events = []
    async for ev in gen:
        events.append(ev)
    return events


# ── empty message ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_empty_message_yields_events(monkeypatch):
    """Empty string message should not crash — it should produce at least one event."""
    from unittest.mock import AsyncMock, patch

    engine = _make_engine()

    async def fake_stream(messages, model=None):
        yield "Hello"

    async def fake_route(message, *, has_kb_sources):
        from chat.orchestrator import RouteDecision

        return RouteDecision("direct", frozenset(), "test")

    with (
        patch("chat.engine.llm_gateway") as gw,
        patch("chat.engine.get_orchestrator") as get_orch,
        patch("chat.engine.kb_has_sources", new=AsyncMock(return_value=False)),
        patch.object(engine.memory, "build_system_prompt", new=AsyncMock(return_value="")),
        patch.object(engine.memory, "maybe_compress", new=AsyncMock()),
    ):
        gw.stream_from_raw = fake_stream
        orch = AsyncMock()
        orch.route = fake_route
        get_orch.return_value = orch

        events = await _collect(engine.stream_response(""))

    types = [e["type"] for e in events]
    assert "token" in types or "error" in types, f"Expected token or error event, got: {types}"


# ── max tool rounds exhaustion ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_max_tool_rounds_terminates(monkeypatch):
    """Engine must not loop forever when LLM keeps requesting tools."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from chat.engine import MAX_TOOL_ROUNDS, ChatEngine
    from core.permissions.gate import Mode
    from core.session.manager import Session

    session = Session(session_id="loop-test", mode=Mode.CHAT)
    engine = ChatEngine(session, db=None)

    # Build a fake tool call that the LLM "returns" every round
    def _make_tc():
        tc = MagicMock()
        tc.id = "call_1"
        tc.function.name = "web_search"
        tc.function.arguments = '{"query": "test"}'
        return tc

    call_count = 0

    async def fake_complete_with_tools(messages, tool_schemas, model=None):
        nonlocal call_count
        call_count += 1
        from core.llm.gateway import LLMUsage

        msg = MagicMock()
        msg.tool_calls = [_make_tc()]
        msg.content = None
        return msg, LLMUsage()

    async def fake_stream(messages, model=None):
        yield "final answer"

    async def fake_tool_run(**kwargs):
        result = MagicMock()
        result.success = True
        result.output = "search result"
        return result

    fake_tool = MagicMock()
    fake_tool.run = AsyncMock(side_effect=lambda **kw: _make_result())

    def _make_result():
        r = MagicMock()
        r.success = True
        r.output = "result"
        return r

    fake_tool.run = AsyncMock(side_effect=lambda **kw: _make_result())

    async def fake_route(message, *, has_kb_sources):
        from chat.orchestrator import RouteDecision

        return RouteDecision("tools", frozenset({"web_search"}), "test")

    with (
        patch("chat.engine.llm_gateway") as gw,
        patch("chat.engine.tool_registry") as reg,
        patch("chat.engine.get_orchestrator") as get_orch,
        patch("chat.engine.kb_has_sources", new=AsyncMock(return_value=False)),
        patch.object(engine.memory, "build_system_prompt", new=AsyncMock(return_value="")),
        patch.object(engine.memory, "maybe_compress", new=AsyncMock()),
        patch.object(engine.memory, "add_user_turn"),
        patch.object(engine.memory, "get_messages", return_value=[{"role": "user", "content": "test"}]),
        patch.object(engine.memory, "add_assistant_turn"),
    ):
        gw.complete_with_tools_raw = AsyncMock(side_effect=fake_complete_with_tools)
        gw.stream_from_raw = fake_stream
        reg.get_openai_schemas.return_value = [
            {"function": {"name": "web_search"}, "type": "function"}
        ]
        reg.get_tools.return_value = {"web_search": fake_tool}
        orch = AsyncMock()
        orch.route = fake_route
        get_orch.return_value = orch

        events = await _collect(engine.stream_response("test"))

    # Must have terminated (not infinite loop) and yielded a token
    token_events = [e for e in events if e["type"] == "token"]
    assert len(token_events) > 0, "Expected at least one token after max rounds"
    assert call_count <= MAX_TOOL_ROUNDS, f"LLM called {call_count} times, max is {MAX_TOOL_ROUNDS}"


# ── tool execution failure ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tool_failure_continues_to_final_answer(monkeypatch):
    """A failing tool should yield tool_result(success=False) but still stream a final answer."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from chat.engine import ChatEngine
    from core.permissions.gate import Mode
    from core.session.manager import Session

    session = Session(session_id="fail-test", mode=Mode.CHAT)
    engine = ChatEngine(session, db=None)

    def _make_tc():
        tc = MagicMock()
        tc.id = "call_err"
        tc.function.name = "web_search"
        tc.function.arguments = "{}"
        return tc

    call_round = 0

    async def fake_complete(messages, tool_schemas, model=None):
        nonlocal call_round
        call_round += 1
        from core.llm.gateway import LLMUsage

        msg = MagicMock()
        # First round: request a tool.  Second round: plain answer.
        if call_round == 1:
            msg.tool_calls = [_make_tc()]
            msg.content = None
        else:
            msg.tool_calls = []
            msg.content = "answer"
        return msg, LLMUsage()

    async def fake_stream(messages, model=None):
        yield "done"

    def _failing_result():
        r = MagicMock()
        r.success = False
        r.error = "network error"
        r.output = None
        return r

    fake_tool = MagicMock()
    fake_tool.run = AsyncMock(side_effect=lambda **kw: _failing_result())

    async def fake_route(message, *, has_kb_sources):
        from chat.orchestrator import RouteDecision

        return RouteDecision("tools", frozenset({"web_search"}), "test")

    with (
        patch("chat.engine.llm_gateway") as gw,
        patch("chat.engine.tool_registry") as reg,
        patch("chat.engine.get_orchestrator") as get_orch,
        patch("chat.engine.kb_has_sources", new=AsyncMock(return_value=False)),
        patch.object(engine.memory, "build_system_prompt", new=AsyncMock(return_value="")),
        patch.object(engine.memory, "maybe_compress", new=AsyncMock()),
        patch.object(engine.memory, "add_user_turn"),
        patch.object(engine.memory, "get_messages", return_value=[{"role": "user", "content": "search something"}]),
        patch.object(engine.memory, "add_assistant_turn"),
    ):
        gw.complete_with_tools_raw = AsyncMock(side_effect=fake_complete)
        gw.stream_from_raw = fake_stream
        reg.get_openai_schemas.return_value = [
            {"function": {"name": "web_search"}, "type": "function"}
        ]
        reg.get_tools.return_value = {"web_search": fake_tool}
        orch = AsyncMock()
        orch.route = fake_route
        get_orch.return_value = orch

        events = await _collect(engine.stream_response("search something"))

    failed = [e for e in events if e["type"] == "tool_result" and not e["success"]]
    tokens = [e for e in events if e["type"] == "token"]
    assert failed, "Expected at least one failed tool_result event"
    assert tokens, "Expected final token stream after tool failure"


# ── model forwarding through all three code paths ────────────────────────────


@pytest.mark.asyncio
async def test_model_forwarded_on_direct_path():
    """route=direct: model param must reach llm_gateway.stream_from_raw."""
    from unittest.mock import AsyncMock, patch

    engine = _make_engine("model-direct")
    received_model: list = []

    async def capturing_stream(messages, model=None):
        received_model.append(model)
        yield "answer"

    async def fake_route(message, *, has_kb_sources):
        from chat.orchestrator import RouteDecision

        return RouteDecision("direct", frozenset(), "test")

    with (
        patch("chat.engine.llm_gateway") as gw,
        patch("chat.engine.get_orchestrator") as get_orch,
        patch("chat.engine.kb_has_sources", new=AsyncMock(return_value=False)),
        patch.object(engine.memory, "build_system_prompt", new=AsyncMock(return_value="")),
        patch.object(engine.memory, "maybe_compress", new=AsyncMock()),
        patch.object(engine.memory, "add_user_turn"),
        patch.object(engine.memory, "get_messages", return_value=[]),
        patch.object(engine.memory, "add_assistant_turn"),
    ):
        gw.stream_from_raw = capturing_stream
        orch = AsyncMock()
        orch.route = fake_route
        get_orch.return_value = orch

        await _collect(engine.stream_response("hello", model="llama3:8b"))

    assert received_model == ["llama3:8b"], (
        f"Expected model='llama3:8b' on direct path, got {received_model}"
    )


@pytest.mark.asyncio
async def test_model_forwarded_on_web_search_fast_path():
    """route=tools(web_search only): model param must reach the fast-path stream call."""
    from unittest.mock import AsyncMock, MagicMock, patch

    engine = _make_engine("model-search")
    received_model: list = []

    async def capturing_stream(messages, model=None):
        received_model.append(model)
        yield "answer"

    def _ok_result():
        r = MagicMock()
        r.success = True
        r.output = "search result"
        return r

    fake_tool = MagicMock()
    fake_tool.run = AsyncMock(side_effect=lambda **kw: _ok_result())

    async def fake_route(message, *, has_kb_sources):
        from chat.orchestrator import RouteDecision

        return RouteDecision("tools", frozenset({"web_search"}), "test")

    with (
        patch("chat.engine.llm_gateway") as gw,
        patch("chat.engine.tool_registry") as reg,
        patch("chat.engine.get_orchestrator") as get_orch,
        patch("chat.engine.kb_has_sources", new=AsyncMock(return_value=False)),
        patch.object(engine.memory, "build_system_prompt", new=AsyncMock(return_value="")),
        patch.object(engine.memory, "maybe_compress", new=AsyncMock()),
        patch.object(engine.memory, "add_user_turn"),
        patch.object(engine.memory, "get_messages", return_value=[{"role": "user", "content": "weather?"}]),
        patch.object(engine.memory, "add_assistant_turn"),
    ):
        gw.stream_from_raw = capturing_stream
        reg.get_tools.return_value = {"web_search": fake_tool}
        orch = AsyncMock()
        orch.route = fake_route
        get_orch.return_value = orch

        await _collect(engine.stream_response("weather?", model="gemma2:9b"))

    assert "gemma2:9b" in received_model, (
        f"Expected model='gemma2:9b' on web-search fast path, got {received_model}"
    )


@pytest.mark.asyncio
async def test_model_forwarded_on_agentic_loop_path():
    """route=rag_and_tools: model param must reach complete_with_tools_raw and stream_from_raw."""
    from unittest.mock import AsyncMock, MagicMock, patch

    engine = _make_engine("model-agentic")
    received_complete_model: list = []
    received_stream_model: list = []

    async def capturing_complete(messages, tool_schemas, model=None):
        received_complete_model.append(model)
        from core.llm.gateway import LLMUsage

        msg = MagicMock()
        msg.tool_calls = []
        msg.content = "done"
        return msg, LLMUsage()

    async def capturing_stream(messages, model=None):
        received_stream_model.append(model)
        yield "final"

    async def fake_route(message, *, has_kb_sources):
        from chat.orchestrator import RouteDecision

        # Use rag_and_tools with render_chart to avoid the web_search fast path
        return RouteDecision("rag_and_tools", frozenset({"render_chart"}), "test")

    with (
        patch("chat.engine.llm_gateway") as gw,
        patch("chat.engine.tool_registry") as reg,
        patch("chat.engine.get_orchestrator") as get_orch,
        patch("chat.engine.kb_has_sources", new=AsyncMock(return_value=False)),
        patch.object(engine._retriever, "retrieve", new=AsyncMock(return_value=[])),
        patch.object(engine.memory, "build_system_prompt", new=AsyncMock(return_value="")),
        patch.object(engine.memory, "maybe_compress", new=AsyncMock()),
        patch.object(engine.memory, "add_user_turn"),
        patch.object(engine.memory, "get_messages", return_value=[{"role": "user", "content": "chart"}]),
        patch.object(engine.memory, "add_assistant_turn"),
    ):
        gw.complete_with_tools_raw = AsyncMock(side_effect=capturing_complete)
        gw.stream_from_raw = capturing_stream
        reg.get_openai_schemas.return_value = [{"function": {"name": "render_chart"}, "type": "function"}]
        reg.get_tools.return_value = {}
        orch = AsyncMock()
        orch.route = fake_route
        get_orch.return_value = orch

        await _collect(engine.stream_response("make a chart", model="phi3:mini"))

    assert received_complete_model == ["phi3:mini"], (
        f"complete_with_tools_raw got model={received_complete_model}"
    )
    assert "phi3:mini" in received_stream_model, (
        f"stream_from_raw got model={received_stream_model}"
    )


# ── LLM gateway exception ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_gateway_exception_yields_error_event(monkeypatch):
    """If llm_gateway.stream_from_raw raises, the engine should emit an error event."""
    from unittest.mock import AsyncMock, patch

    from chat.engine import ChatEngine
    from core.permissions.gate import Mode
    from core.session.manager import Session

    session = Session(session_id="gw-err", mode=Mode.CHAT)
    engine = ChatEngine(session, db=None)

    async def exploding_stream(messages, model=None):
        raise RuntimeError("LLM is down")
        yield  # make it a generator

    async def fake_route(message, *, has_kb_sources):
        from chat.orchestrator import RouteDecision

        return RouteDecision("direct", frozenset(), "test")

    raised = None

    async def _collect_safe(gen):
        """Collect events; capture any exception the generator propagates."""
        nonlocal raised
        evts = []
        try:
            async for ev in gen:
                evts.append(ev)
        except Exception as exc:
            raised = exc
        return evts

    with (
        patch("chat.engine.llm_gateway") as gw,
        patch("chat.engine.get_orchestrator") as get_orch,
        patch("chat.engine.kb_has_sources", new=AsyncMock(return_value=False)),
        patch.object(engine.memory, "build_system_prompt", new=AsyncMock(return_value="")),
        patch.object(engine.memory, "maybe_compress", new=AsyncMock()),
        patch.object(engine.memory, "add_user_turn"),
        patch.object(engine.memory, "get_messages", return_value=[]),
        patch.object(engine.memory, "add_assistant_turn"),
    ):
        gw.stream_from_raw = exploding_stream
        orch_mock = AsyncMock()
        orch_mock.route = fake_route
        get_orch.return_value = orch_mock

        engine._db = None

        events = await _collect_safe(engine.stream_response("hello"))

    # When stream_from_raw raises, the engine either re-raises or yields an error event.
    # Either way: the iteration must complete (no hang) and not silently swallow the error.
    error_events = [e for e in events if e.get("type") == "error"]
    assert raised is not None or error_events, (
        "Expected either a raised exception or an error event when the LLM gateway throws"
    )
