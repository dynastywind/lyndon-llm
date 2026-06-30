"""Repository for scheduled tasks."""

from __future__ import annotations

from datetime import UTC, datetime
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.scheduler.schedule import compute_next_run
from db.models.scheduled_task import ScheduledTask

# Fields that affect when the task next fires; changing any of them (or `enabled`)
# triggers a `next_run_at` recompute on update.
_SCHEDULE_FIELDS = {"schedule_kind", "interval_seconds", "time_of_day", "weekday"}


def _now() -> datetime:
    return datetime.now(UTC)


class ScheduledTaskRepo:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create(
        self,
        *,
        user_id: str,
        name: str,
        goal: str,
        schedule_kind: str,
        interval_seconds: int | None = None,
        time_of_day: str | None = None,
        weekday: int | None = None,
        acting_mode: str = "auto",
        enabled: bool = True,
    ) -> ScheduledTask:
        next_run = (
            compute_next_run(
                schedule_kind,
                interval_seconds=interval_seconds,
                time_of_day=time_of_day,
                weekday=weekday,
                after=_now(),
            )
            if enabled
            else None
        )
        row = ScheduledTask(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=name,
            goal=goal,
            schedule_kind=schedule_kind,
            interval_seconds=interval_seconds,
            time_of_day=time_of_day,
            weekday=weekday,
            acting_mode=acting_mode,
            enabled=enabled,
            next_run_at=next_run,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def get(self, task_id: str) -> ScheduledTask | None:
        result = await self._db.execute(
            select(ScheduledTask).where(ScheduledTask.id == task_id)
        )
        return result.scalar_one_or_none()

    async def get_for_user(self, task_id: str, user_id: str) -> ScheduledTask | None:
        result = await self._db.execute(
            select(ScheduledTask).where(
                ScheduledTask.id == task_id, ScheduledTask.user_id == user_id
            )
        )
        return result.scalar_one_or_none()

    async def list_for_user(self, user_id: str) -> list[ScheduledTask]:
        result = await self._db.execute(
            select(ScheduledTask)
            .where(ScheduledTask.user_id == user_id)
            .order_by(ScheduledTask.created_at.desc())
        )
        return list(result.scalars().all())

    async def update(self, task: ScheduledTask, **fields) -> ScheduledTask:
        for key, value in fields.items():
            setattr(task, key, value)
        # Recompute the next firing time whenever the schedule or enabled flag moves.
        if fields and (_SCHEDULE_FIELDS & fields.keys() or "enabled" in fields):
            task.next_run_at = (
                compute_next_run(
                    task.schedule_kind,
                    interval_seconds=task.interval_seconds,
                    time_of_day=task.time_of_day,
                    weekday=task.weekday,
                    after=_now(),
                )
                if task.enabled
                else None
            )
        await self._db.commit()
        await self._db.refresh(task)
        return task

    async def delete(self, task_id: str) -> bool:
        row = await self.get(task_id)
        if row is None:
            return False
        await self._db.delete(row)
        await self._db.commit()
        return True

    async def list_due(self, now: datetime) -> list[ScheduledTask]:
        result = await self._db.execute(
            select(ScheduledTask).where(
                ScheduledTask.enabled.is_(True),
                ScheduledTask.next_run_at.is_not(None),
                ScheduledTask.next_run_at <= now,
            )
        )
        return list(result.scalars().all())

    async def list_enabled_without_next_run(self) -> list[ScheduledTask]:
        result = await self._db.execute(
            select(ScheduledTask).where(
                ScheduledTask.enabled.is_(True), ScheduledTask.next_run_at.is_(None)
            )
        )
        return list(result.scalars().all())

    async def mark_running(self, task_id: str) -> None:
        await self._db.execute(
            update(ScheduledTask)
            .where(ScheduledTask.id == task_id)
            .values(last_status="running")
        )
        await self._db.commit()

    async def mark_run(
        self,
        task_id: str,
        *,
        status: str,
        error: str | None,
        session_id: str | None,
        ran_at: datetime,
        next_run_at: datetime | None,
    ) -> None:
        await self._db.execute(
            update(ScheduledTask)
            .where(ScheduledTask.id == task_id)
            .values(
                last_status=status,
                last_error=error,
                last_session_id=session_id,
                last_run_at=ran_at,
                next_run_at=next_run_at,
            )
        )
        await self._db.commit()

    async def set_next_run(self, task_id: str, next_run_at: datetime) -> None:
        await self._db.execute(
            update(ScheduledTask)
            .where(ScheduledTask.id == task_id)
            .values(next_run_at=next_run_at)
        )
        await self._db.commit()
