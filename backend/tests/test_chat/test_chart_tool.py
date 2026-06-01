import json

import pytest


@pytest.mark.asyncio
async def test_render_chart_coerces_json_string_arrays():
    from chat.tools.chart import CHART_SPEC_KEY, RenderChartTool
    from core.permissions.gate import Mode, PermissionGate

    tool = RenderChartTool(PermissionGate(Mode.CHAT))

    result = await tool.run(
        type="bar",
        title="Quarterly Revenue",
        x_key="quarter",
        data=json.dumps(
            [
                {"quarter": "Q1", "revenue": 120},
                {"quarter": "Q2", "revenue": 180},
            ]
        ),
        series=json.dumps(
            [
                {"key": "revenue", "name": "Revenue", "color": "#6366f1"},
            ]
        ),
    )

    assert result.success
    payload = json.loads(result.output)
    spec = payload[CHART_SPEC_KEY]
    assert spec["data"] == [
        {"quarter": "Q1", "revenue": 120},
        {"quarter": "Q2", "revenue": 180},
    ]
    assert spec["series"] == [
        {"key": "revenue", "name": "Revenue", "color": "#6366f1"},
    ]


@pytest.mark.asyncio
async def test_agentic_loop_continues_after_successful_chart(monkeypatch):
    from chat.engine import ChatEngine
    from chat.tools.chart import RenderChartTool
    from core.permissions.gate import Mode
    from core.session.manager import Session
    from core.tools.registry import tool_registry

    tool_registry.register(Mode.CHAT, RenderChartTool)

    class FakeFunction:
        name = "render_chart"
        arguments = json.dumps(
            {
                "type": "bar",
                "title": "Quarterly Revenue",
                "x_key": "quarter",
                "data": [
                    {"quarter": "Q1", "revenue": 120},
                    {"quarter": "Q2", "revenue": 180},
                ],
            }
        )

    class FakeToolCall:
        id = "call_chart"
        function = FakeFunction()

    class FakeMessage:
        content = None
        tool_calls = [FakeToolCall()]

    class FinalMessage:
        content = "Here is the explanation."
        tool_calls = []

    calls = 0
    streamed_messages = None

    async def fake_complete_with_tools_raw(messages, tools, model=None):
        nonlocal calls
        calls += 1
        from core.llm.gateway import LLMUsage

        return (FakeMessage() if calls == 1 else FinalMessage()), LLMUsage()

    async def fake_stream_from_raw(messages, model=None):
        nonlocal streamed_messages
        streamed_messages = messages
        yield "Here is the trend."

    from chat import engine as engine_module

    monkeypatch.setattr(
        engine_module.llm_gateway,
        "complete_with_tools_raw",
        fake_complete_with_tools_raw,
    )
    monkeypatch.setattr(engine_module.llm_gateway, "stream_from_raw", fake_stream_from_raw)

    engine = ChatEngine(Session("chart-session", Mode.CHAT))
    engine.memory.short_term.set_system_prompt("system")
    engine.memory.add_user_turn("render a chart")

    events = [event async for event in engine._agentic_loop()]

    # Filter out internal _usage bookkeeping events before asserting the public sequence
    public_events = [e for e in events if e["type"] != "_usage"]
    assert [e["type"] for e in public_events] == [
        "tool_start",
        "chart",
        "tool_result",
        "token",
    ]
    assert events[-1]["text"] == "Here is the trend."
    assert streamed_messages is not None
    tool_message = streamed_messages[-1]["content"]
    assert "render_chart tool succeeded" in tool_message
    assert "already been rendered" in tool_message
