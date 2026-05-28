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
        data=json.dumps([
            {"quarter": "Q1", "revenue": 120},
            {"quarter": "Q2", "revenue": 180},
        ]),
        series=json.dumps([
            {"key": "revenue", "name": "Revenue", "color": "#6366f1"},
        ]),
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
async def test_agentic_loop_stops_after_successful_chart(monkeypatch):
    from chat.engine import ChatEngine
    from core.permissions.gate import Mode
    from core.session.manager import Session

    class FakeFunction:
        name = "render_chart"
        arguments = json.dumps({
            "type": "bar",
            "title": "Quarterly Revenue",
            "x_key": "quarter",
            "data": [
                {"quarter": "Q1", "revenue": 120},
                {"quarter": "Q2", "revenue": 180},
            ],
        })

    class FakeToolCall:
        id = "call_chart"
        function = FakeFunction()

    class FakeMessage:
        content = None
        tool_calls = [FakeToolCall()]

    async def fake_complete_with_tools_raw(messages, tools):
        return FakeMessage()

    async def fail_if_streamed(messages):
        raise AssertionError("final LLM stream should not run after chart rendering")
        yield ""

    from chat import engine as engine_module

    monkeypatch.setattr(
        engine_module.llm_gateway,
        "complete_with_tools_raw",
        fake_complete_with_tools_raw,
    )
    monkeypatch.setattr(engine_module.llm_gateway, "stream_from_raw", fail_if_streamed)

    engine = ChatEngine(Session("chart-session", Mode.CHAT))
    engine.memory.short_term.set_system_prompt("system")
    engine.memory.add_user_turn("render a chart")

    events = [event async for event in engine._agentic_loop()]

    assert [event["type"] for event in events] == [
        "tool_start",
        "chart",
        "tool_result",
    ]
