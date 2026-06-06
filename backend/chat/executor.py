"""
Chat Executor — runs an approved Plan in Chat mode, yielding SSE-ready event dicts.

Differences from cowork.executor.Executor:
  - Uses Mode.CHAT tools (read-only; no shell / file-write)
  - Yields SSE event dicts directly instead of emitting to the event bus
  - Adds a synthesis step after all tool steps complete
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from config.settings import settings
from core.llm.gateway import LLMMessage, LLMUsage, llm_gateway
from core.session.manager import Session
from cowork.executor import StepResult, StepStatus
from cowork.planner import Plan, PlanStep


class ChatExecutor:
    def __init__(
        self,
        session: Session,
        user_id: str | None = None,
        project_context: str = "",
    ) -> None:
        self.session = session
        self.user_id = user_id
        self.project_context = project_context
        self._step_statuses: dict[str, StepStatus] = {}

    async def run(self, plan: Plan) -> AsyncGenerator[dict[str, Any], None]:
        if not plan.approved:
            raise RuntimeError("Cannot execute an unapproved plan.")

        results: list[StepResult] = []
        step_outputs: list[str] = []

        for step in plan.steps:
            # Dependency check — skip steps whose deps did not complete
            skip = False
            for dep_id in step.depends_on:
                if self._step_statuses.get(dep_id) != StepStatus.DONE:
                    self._step_statuses[step.step_id] = StepStatus.SKIPPED
                    results.append(
                        StepResult(
                            step.step_id,
                            StepStatus.SKIPPED,
                            error=f"Dependency {dep_id} did not complete.",
                        )
                    )
                    skip = True
                    break
            if skip:
                continue

            yield {
                "type": "plan_step_started",
                "step_id": step.step_id,
                "order": step.order,
                "title": step.title,
            }

            result = await self._run_step(step)
            results.append(result)
            self._step_statuses[step.step_id] = result.status

            if result.status == StepStatus.DONE:
                output_preview = (result.output or "")[:500]
                step_outputs.append(result.output or "")
                yield {
                    "type": "plan_step_done",
                    "step_id": step.step_id,
                    "output": output_preview,
                }
            else:
                yield {
                    "type": "plan_step_failed",
                    "step_id": step.step_id,
                    "error": result.error or "Unknown error",
                }
                break  # stop on first failure

        yield {
            "type": "plan_done",
            "plan_id": plan.plan_id,
            "results": [
                {
                    "step_id": r.step_id,
                    "status": str(r.status),
                    "output": (r.output or "")[:500] if r.output else None,
                    "error": r.error,
                }
                for r in results
            ],
        }

        # Synthesis — stream a final answer using accumulated step outputs
        async for chunk in self._synthesize(plan.goal, step_outputs):
            yield chunk

    async def _run_step(self, step: PlanStep) -> StepResult:
        self._step_statuses[step.step_id] = StepStatus.RUNNING
        try:
            from core.permissions.gate import Mode
            from core.tools.registry import tool_registry

            tools = tool_registry.get_tools(Mode.CHAT, self.session.gate, user_id=self.user_id)

            if step.tool not in tools:
                return StepResult(
                    step.step_id,
                    StepStatus.FAILED,
                    error=f"Unknown chat tool: {step.tool!r}",
                )

            # Validate required args
            schema = tools[step.tool].schema()
            required = schema.get("parameters", {}).get("required", [])
            missing = [k for k in required if k not in step.tool_args]
            if missing:
                return StepResult(
                    step.step_id,
                    StepStatus.FAILED,
                    error=f"Missing required arg(s): {', '.join(missing)}",
                )

            result = await tools[step.tool].run(**step.tool_args)
            status = StepStatus.DONE if result.success else StepStatus.FAILED
            return StepResult(step.step_id, status, output=result.output, error=result.error)

        except Exception as e:
            return StepResult(step.step_id, StepStatus.FAILED, error=str(e))

    async def _synthesize(
        self, goal: str, step_outputs: list[str]
    ) -> AsyncGenerator[dict[str, Any], None]:
        if not step_outputs:
            yield {
                "type": "token",
                "text": "I was unable to complete the plan — all steps failed or were skipped.",
            }
            return

        result_block = "\n\n".join(
            f"Step {i + 1} result:\n{out}" for i, out in enumerate(step_outputs)
        )
        synthesis_prompt = (
            f"The user asked: {goal}\n\n"
            f"Here are the results from the tools I ran:\n\n{result_block}\n\n"
            "Write a concise, helpful answer synthesizing these results for the user."
        )

        from chat.engine import _ThinkingStreamParser
        cot_parser = _ThinkingStreamParser() if settings.cot_enabled else None

        system_prompt = (
            "You are a helpful assistant. Synthesize the tool results below into a "
            "clear, accurate answer to the user's request. Be concise and factual."
        )
        if self.project_context:
            system_prompt = f"{system_prompt}\n\n{self.project_context}"

        async for chunk in llm_gateway.stream(
            [
                LLMMessage("system", system_prompt),
                LLMMessage("user", synthesis_prompt),
            ]
        ):
            if isinstance(chunk, LLMUsage):
                if cot_parser:
                    for evt_type, text in cot_parser.flush():
                        if text:
                            yield {"type": evt_type, "text": text}
                continue
            if cot_parser:
                for evt_type, text in cot_parser.feed(chunk):
                    if text:
                        yield {"type": evt_type, "text": text}
            else:
                yield {"type": "token", "text": chunk}
