"""
Scheduled-task management endpoints — user-scoped CRUD plus run-now.

Each task runs a cowork goal on a recurring simple-preset schedule; the
background runner (core/scheduler/runner.py) fires them.
"""

from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth_deps import get_current_user
from core.scheduler.runner import scheduler_runner
from core.scheduler.schedule import validate_schedule
from db.base import get_db
from db.models.scheduled_task import ScheduledTask
from db.models.user import User
from db.repos.scheduled_task import ScheduledTaskRepo

router = APIRouter()


class CreateTaskRequest(BaseModel):
    name: str
    goal: str
    schedule_kind: str  # interval | daily | weekly
    interval_seconds: int | None = None
    time_of_day: str | None = None  # "HH:MM"
    weekday: int | None = None  # 0=Mon..6=Sun
    acting_mode: str = "auto"  # auto | auto_safe
    enabled: bool = True


class UpdateTaskRequest(BaseModel):
    name: str | None = None
    goal: str | None = None
    schedule_kind: str | None = None
    interval_seconds: int | None = None
    time_of_day: str | None = None
    weekday: int | None = None
    acting_mode: str | None = None
    enabled: bool | None = None


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _serialize(t: ScheduledTask) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "goal": t.goal,
        "schedule_kind": t.schedule_kind,
        "interval_seconds": t.interval_seconds,
        "time_of_day": t.time_of_day,
        "weekday": t.weekday,
        "acting_mode": t.acting_mode,
        "enabled": t.enabled,
        "last_run_at": _iso(t.last_run_at),
        "next_run_at": _iso(t.next_run_at),
        "last_status": t.last_status,
        "last_error": t.last_error,
        "last_session_id": t.last_session_id,
        "created_at": _iso(t.created_at),
        "updated_at": _iso(t.updated_at),
    }


@router.get("")
async def list_tasks(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    tasks = await ScheduledTaskRepo(db).list_for_user(user.id)
    return {"tasks": [_serialize(t) for t in tasks]}


@router.post("")
async def create_task(
    body: CreateTaskRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    try:
        validate_schedule(
            body.schedule_kind,
            interval_seconds=body.interval_seconds,
            time_of_day=body.time_of_day,
            weekday=body.weekday,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    task = await ScheduledTaskRepo(db).create(
        user_id=user.id,
        name=body.name.strip() or "Untitled task",
        goal=body.goal,
        schedule_kind=body.schedule_kind,
        interval_seconds=body.interval_seconds,
        time_of_day=body.time_of_day,
        weekday=body.weekday,
        acting_mode=body.acting_mode,
        enabled=body.enabled,
    )
    return _serialize(task)


@router.patch("/{task_id}")
async def update_task(
    task_id: str,
    body: UpdateTaskRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    repo = ScheduledTaskRepo(db)
    task = await repo.get_for_user(task_id, user.id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    fields = body.model_dump(exclude_unset=True)
    # If any schedule field changes, validate the resulting schedule.
    if {"schedule_kind", "interval_seconds", "time_of_day", "weekday"} & fields.keys():
        try:
            validate_schedule(
                fields.get("schedule_kind", task.schedule_kind),
                interval_seconds=fields.get("interval_seconds", task.interval_seconds),
                time_of_day=fields.get("time_of_day", task.time_of_day),
                weekday=fields.get("weekday", task.weekday),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    task = await repo.update(task, **fields)
    return _serialize(task)


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    repo = ScheduledTaskRepo(db)
    task = await repo.get_for_user(task_id, user.id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    await repo.delete(task_id)


@router.post("/{task_id}/run-now")
async def run_now(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    task = await ScheduledTaskRepo(db).get_for_user(task_id, user.id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    # Fire-and-forget — does not touch next_run_at.
    asyncio.create_task(scheduler_runner.run_task(task_id, user.id, advance_schedule=False))
    return {"status": "started"}
