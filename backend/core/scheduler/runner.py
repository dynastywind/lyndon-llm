"""
Scheduled-task runner — a dependency-free asyncio loop that fires due tasks.

Each task runs a cowork goal unattended: plan → approve → execute (mirroring
api/routes/cowork.py, but without the human review round-trip). Results are
persisted to a fresh cowork session so they appear in the user's history.
"""

from __future__ import annotations

import asyncio
from contextlib import suppress
from datetime import UTC, datetime
import logging
import uuid

from config.settings import settings
from core.scheduler.schedule import compute_next_run

logger = logging.getLogger(__name__)


class SchedulerRunner:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        await self._recompute_stale_next_runs()
        self._task = asyncio.create_task(self._loop())
        logger.info("Scheduler started (poll every %ss)", settings.scheduler_poll_seconds)

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self._tick()
            except Exception:  # never let one bad tick kill the loop
                logger.exception("Scheduler tick failed")
            await asyncio.sleep(settings.scheduler_poll_seconds)

    async def _recompute_stale_next_runs(self) -> None:
        """
        On startup, give any enabled task without a `next_run_at` a fresh future
        time. We deliberately do NOT retro-fire runs missed while the server was
        down (avoids a thundering herd after downtime).
        """
        from db.base import AsyncSessionLocal
        from db.repos.scheduled_task import ScheduledTaskRepo

        now = datetime.now(UTC)
        async with AsyncSessionLocal() as db:
            repo = ScheduledTaskRepo(db)
            for task in await repo.list_enabled_without_next_run():
                with suppress(Exception):
                    await repo.set_next_run(
                        task.id,
                        compute_next_run(
                            task.schedule_kind,
                            interval_seconds=task.interval_seconds,
                            time_of_day=task.time_of_day,
                            weekday=task.weekday,
                            after=now,
                        ),
                    )

    async def _tick(self) -> None:
        from db.base import AsyncSessionLocal
        from db.repos.scheduled_task import ScheduledTaskRepo

        now = datetime.now(UTC)
        async with AsyncSessionLocal() as db:
            due = await ScheduledTaskRepo(db).list_due(now)

        # Run sequentially, each in its own DB session, so one slow/failing task
        # doesn't block or roll back the others.
        for task in due:
            await self.run_task(task.id, task.user_id)

    async def run_task(
        self, task_id: str, user_id: str, *, advance_schedule: bool = True
    ) -> None:
        """Execute a single scheduled task end-to-end.

        `advance_schedule=False` (run-now) leaves `next_run_at` untouched so a
        manual run doesn't shift the recurring schedule.
        """
        from chat.project_context import build_project_block
        from core.permissions.gate import Mode
        from core.session.manager import Session
        from cowork.executor import Executor
        from cowork.planner import Planner, RiskLevel
        from db.base import AsyncSessionLocal
        from db.repos.chat import ChatRepo
        from db.repos.scheduled_task import ScheduledTaskRepo

        now = datetime.now(UTC)
        async with AsyncSessionLocal() as db:
            repo = ScheduledTaskRepo(db)
            task = await repo.get(task_id)
            if task is None:
                return

            await repo.mark_running(task_id)

            session_id = str(uuid.uuid4())
            status = "ok"
            error: str | None = None
            try:
                chat_repo = ChatRepo(db)
                await chat_repo.create_session(session_id, mode="cowork", user_id=user_id)
                await chat_repo.rename_session(session_id, task.name)
                await chat_repo.add_message(session_id, "user", task.goal)

                project_block = await build_project_block(db, session_id, task.goal, user_id)
                plan = await Planner().create_plan(
                    task.goal, session_id=session_id, project_context=project_block
                )

                if task.acting_mode == "auto_safe":
                    plan.steps = [s for s in plan.steps if s.risk != RiskLevel.HIGH]

                plan.approved = True
                results = await Executor(Session(session_id, Mode.COWORK)).run(plan)

                await chat_repo.add_message(
                    session_id, "assistant", _format_results(plan, results)
                )
                await chat_repo.touch_session(session_id)
            except Exception as exc:  # record failure, keep the schedule alive
                status = "error"
                error = str(exc)
                logger.exception("Scheduled task %s failed", task_id)

            next_run = (
                compute_next_run(
                    task.schedule_kind,
                    interval_seconds=task.interval_seconds,
                    time_of_day=task.time_of_day,
                    weekday=task.weekday,
                    after=now,
                )
                if advance_schedule
                else task.next_run_at
            )
            await repo.mark_run(
                task_id,
                status=status,
                error=error,
                session_id=session_id if status == "ok" else None,
                ran_at=now,
                next_run_at=next_run,
            )


def _format_results(plan, results) -> str:
    """Render a markdown summary of an executed plan + per-step outcomes."""
    from cowork.executor import StepStatus

    icon = {
        StepStatus.DONE: "✅",
        StepStatus.FAILED: "❌",
        StepStatus.SKIPPED: "⏭️",
    }
    by_id = {s.step_id: s for s in plan.steps}
    lines = [f"**Scheduled run — {plan.goal}**", ""]
    for r in results:
        step = by_id.get(r.step_id)
        title = step.title if step else r.step_id
        lines.append(f"{icon.get(r.status, '•')} **{title}**")
        if r.error:
            lines.append(f"   - error: {r.error}")
        elif r.output:
            text = str(r.output)
            if len(text) > 600:
                text = text[:600] + "…"
            lines.append(f"   - {text}")
    if not results:
        lines.append("_No steps were executed._")
    return "\n".join(lines)


# Module-level singleton
scheduler_runner = SchedulerRunner()
