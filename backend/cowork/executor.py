"""
Cowork Executor — runs an approved Plan step by step.
Emits events for each step so the frontend can show live progress.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from core.events.bus import Events, event_bus
from core.permissions.gate import Permission
from core.session.manager import Session
from cowork.planner import Plan, PlanStep, RiskLevel


class StepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


class StepResult:
    def __init__(
        self, step_id: str, status: StepStatus, output: Any = None, error: str | None = None
    ):
        self.step_id = step_id
        self.status = status
        self.output = output
        self.error = error


class Executor:
    def __init__(self, session: Session) -> None:
        self.session = session
        self._step_statuses: dict[str, StepStatus] = {}

    async def run(self, plan: Plan) -> list[StepResult]:
        if not plan.approved:
            raise RuntimeError("Cannot execute a plan that has not been approved.")

        results: list[StepResult] = []
        for step in plan.steps:
            # Check dependencies
            for dep_id in step.depends_on:
                dep_status = self._step_statuses.get(dep_id)
                if dep_status != StepStatus.DONE:
                    result = StepResult(
                        step.step_id,
                        StepStatus.SKIPPED,
                        error=f"Dependency {dep_id} did not complete.",
                    )
                    results.append(result)
                    self._step_statuses[step.step_id] = StepStatus.SKIPPED
                    continue

            result = await self._run_step(step)
            results.append(result)
            self._step_statuses[step.step_id] = result.status

            if result.status == StepStatus.FAILED:
                await event_bus.emit(
                    Events.STEP_FAILED,
                    {
                        "session_id": self.session.session_id,
                        "step_id": step.step_id,
                        "error": result.error,
                    },
                )
                # Stop on failure — let user decide whether to retry
                break

        await event_bus.emit(
            Events.TASK_DONE,
            {
                "session_id": self.session.session_id,
                "plan_id": plan.plan_id,
                "results": [r.__dict__ for r in results],
            },
        )
        return results

    async def _run_step(self, step: PlanStep) -> StepResult:
        self._step_statuses[step.step_id] = StepStatus.RUNNING
        await event_bus.emit(
            Events.STEP_STARTED,
            {
                "session_id": self.session.session_id,
                "step_id": step.step_id,
                "title": step.title,
            },
        )

        # Check permissions
        if step.risk in (RiskLevel.MEDIUM, RiskLevel.HIGH):
            self.session.gate.check(Permission.WRITE, tool_name=step.tool)

        try:
            from core.permissions.gate import Mode
            from core.tools.registry import tool_registry

            tools = tool_registry.get_tools(Mode.COWORK, self.session.gate)

            if step.tool not in tools:
                raise ValueError(f"Unknown tool: {step.tool!r}")

            result = await tools[step.tool].run(**step.tool_args)
            status = StepStatus.DONE if result.success else StepStatus.FAILED

            await event_bus.emit(
                Events.STEP_DONE,
                {
                    "session_id": self.session.session_id,
                    "step_id": step.step_id,
                    "output": result.output,
                },
            )
            return StepResult(step.step_id, status, output=result.output, error=result.error)

        except Exception as e:
            return StepResult(step.step_id, StepStatus.FAILED, error=str(e))
