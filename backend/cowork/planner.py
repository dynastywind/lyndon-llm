"""
Cowork Planner — converts a user goal into a structured, executable plan.
"""
from __future__ import annotations

import json
import uuid
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from core.llm.gateway import llm_gateway, LLMMessage


class RiskLevel(str, Enum):
    LOW    = "low"     # read, no side effects
    MEDIUM = "medium"  # writes files or calls APIs
    HIGH   = "high"    # deletes, deploys, runs arbitrary shell


class PlanStep(BaseModel):
    step_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    order: int
    title: str
    description: str
    tool: str               # tool name that will execute this step
    tool_args: dict[str, Any] = Field(default_factory=dict)
    risk: RiskLevel = RiskLevel.LOW
    depends_on: list[str] = Field(default_factory=list)  # step_ids


class Plan(BaseModel):
    plan_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    goal: str
    steps: list[PlanStep]
    approved: bool = False
    session_id: str = ""


PLANNER_SYSTEM = """\
You are a planning agent. Given a user goal, produce a detailed, executable plan.

Output ONLY valid JSON in this exact schema (no markdown, no explanation):
{
  "goal": "<restatement of the goal>",
  "steps": [
    {
      "order": 1,
      "title": "<short title>",
      "description": "<what this step does and why>",
      "tool": "<tool_name>",
      "tool_args": { "<arg>": "<value>" },
      "risk": "low|medium|high",
      "depends_on": []
    }
  ]
}

Risk levels:
  low    = read-only, no side effects
  medium = writes files or calls external APIs
  high   = deletes data, runs shell commands, deploys

Available tools: shell, file_write, file_read, http_request, scheduler
"""


class Planner:
    async def create_plan(self, goal: str, session_id: str = "") -> Plan:
        response = await llm_gateway.complete(
            messages=[
                LLMMessage("system", PLANNER_SYSTEM),
                LLMMessage("user", f"Goal: {goal}"),
            ],
            temperature=0.2,
        )

        # Strip markdown code fences if present
        cleaned = response.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise ValueError(f"Planner returned invalid JSON: {e}\nResponse: {cleaned}")

        steps = [PlanStep(**s) for s in data.get("steps", [])]
        return Plan(
            goal=data.get("goal", goal),
            steps=steps,
            session_id=session_id,
        )

    def format_plan_for_display(self, plan: Plan) -> str:
        """Return a human-readable plan string for the frontend."""
        lines = [f"## Plan: {plan.goal}\n"]
        for step in plan.steps:
            risk_icon = {"low": "🟢", "medium": "🟡", "high": "🔴"}.get(step.risk, "⚪")
            lines.append(
                f"{step.order}. {risk_icon} **{step.title}**\n"
                f"   {step.description}\n"
                f"   *Tool:* `{step.tool}` | *Risk:* {step.risk}\n"
            )
        return "\n".join(lines)
