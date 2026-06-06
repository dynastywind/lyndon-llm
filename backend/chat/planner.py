"""
Chat Planner — generates a structured plan for complex user requests in Chat mode.

Reuses Plan / PlanStep / RiskLevel data models from cowork.planner but uses a
chat-specific system prompt that only lists the 4 read-only CHAT tools.
"""

from __future__ import annotations

import json

from core.llm.gateway import LLMMessage, llm_gateway
from cowork.planner import Plan, PlanStep, RiskLevel  # noqa: F401 — re-exported

CHAT_PLANNER_SYSTEM = """\
You are a planning agent for a chat assistant. Given a complex user request,
produce a structured, executable plan using only the available chat tools.

Output ONLY valid JSON — no markdown, no explanation:
{
  "goal": "<one-sentence restatement of what the user wants>",
  "steps": [
    {
      "order": 1,
      "title": "<short action title>",
      "description": "<what this step does and why it is needed>",
      "tool": "<tool_name>",
      "tool_args": { "<arg>": "<value>" },
      "risk": "low",
      "depends_on": []
    }
  ]
}

Available tools:
  web_search   — args: query (string); searches the web for real-time information
  rag_query    — args: query (string); searches the user's uploaded documents
  render_chart — args: type, title, x_key, data, series; produces a chart
  run_code     — args: language, code; executes code in a secure sandbox

Rules:
  - All steps must use risk="low" (Chat mode is read-only).
  - Only use tools listed above; never hallucinate tool names.
  - depends_on is a list of ORDER NUMBERS (integers) of earlier steps that must
    complete before this step runs. Use order numbers, NOT tool names.
    Example: step 2 that needs step 1 to finish: "depends_on": [1]
  - Keep plans to 2–6 steps. Do not over-plan.
  - The final step should synthesize or summarize the results of prior steps.
"""


def _normalize_depends_on(steps: list[PlanStep]) -> list[PlanStep]:
    """Resolve depends_on entries to real step_ids.

    LLMs often reference dependencies as order numbers (1, 2) or tool names
    ("web_search") rather than the generated step_id UUIDs.  This pass maps
    those references to the correct step_id so the executor can use them.
    """
    order_to_id = {str(s.order): s.step_id for s in steps}
    tool_to_id = {s.tool: s.step_id for s in steps}
    valid_ids = {s.step_id for s in steps}

    for step in steps:
        resolved: list[str] = []
        for dep in step.depends_on:
            dep_str = str(dep)
            if dep_str in valid_ids:
                resolved.append(dep_str)          # already a valid step_id
            elif dep_str in order_to_id:
                resolved.append(order_to_id[dep_str])  # order number → step_id
            elif dep_str in tool_to_id:
                resolved.append(tool_to_id[dep_str])   # tool name → step_id
            # else: unresolvable reference — drop it silently
        step.depends_on = resolved

    return steps


class ChatPlanner:
    async def create_plan(
        self, user_message: str, session_id: str = "", project_context: str = ""
    ) -> Plan:
        system = CHAT_PLANNER_SYSTEM
        if project_context:
            system = f"{system}\n\n{project_context}"
        text, _usage = await llm_gateway.complete(
            messages=[
                LLMMessage("system", system),
                LLMMessage("user", user_message),
            ],
            temperature=0.1,
        )

        cleaned = (
            text.strip()
            .removeprefix("```json")
            .removeprefix("```")
            .removesuffix("```")
            .strip()
        )

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise ValueError(f"Planner returned invalid JSON: {e}\nResponse: {cleaned}") from e

        # Coerce depends_on entries to strings before Pydantic validation —
        # LLMs often emit integers (order numbers) even when the schema says string.
        raw_steps = data.get("steps", [])
        for s in raw_steps:
            if "depends_on" in s:
                s["depends_on"] = [str(d) for d in s["depends_on"]]
        steps = [PlanStep(**s) for s in raw_steps]
        steps = _normalize_depends_on(steps)
        return Plan(
            goal=data.get("goal", user_message),
            steps=steps,
            session_id=session_id,
        )
