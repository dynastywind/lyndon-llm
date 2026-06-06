from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth_deps import get_optional_user
from api.deps import get_session
from core.session.manager import Session
from cowork.executor import Executor
from cowork.planner import Plan, Planner, PlanStep
from db.base import get_db
from db.models.cowork import CoworkPlan as CoworkPlanRow
from db.models.user import User
from db.repos.chat import ChatRepo

router = APIRouter()
_planner = Planner()


class GoalRequest(BaseModel):
    goal: str


class ApproveRequest(BaseModel):
    plan_id: str


@router.post("/plan")
async def create_plan(
    body: GoalRequest,
    session: Session = Depends(get_session),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    from chat.project_context import build_project_block

    project_block = await build_project_block(
        db, session.session_id, body.goal, user.id if user else None
    )
    plan = await _planner.create_plan(
        body.goal, session_id=session.session_id, project_context=project_block
    )
    row = CoworkPlanRow(
        id=plan.plan_id,
        session_id=plan.session_id,
        goal=plan.goal,
        steps_json=json.dumps([s.model_dump() for s in plan.steps]),
        approved=False,
    )
    db.add(row)
    await db.commit()

    repo = ChatRepo(db)
    await repo.ensure_session(
        session.session_id, mode="cowork", user_id=user.id if user else None
    )
    await repo.maybe_set_title(session.session_id, body.goal)

    return {
        "plan_id": plan.plan_id,
        "display": _planner.format_plan_for_display(plan),
        "steps": [s.model_dump() for s in plan.steps],
    }


@router.post("/execute")
async def execute_plan(
    body: ApproveRequest,
    session: Session = Depends(get_session),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(CoworkPlanRow).where(CoworkPlanRow.id == body.plan_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(
            404,
            "Plan not found — it may have been created in a previous session. Please create a new plan.",
        )

    steps = [PlanStep(**s) for s in json.loads(row.steps_json)]
    plan = Plan(
        plan_id=row.id,
        goal=row.goal,
        steps=steps,
        approved=True,
        session_id=row.session_id,
    )

    row.approved = True
    await db.commit()

    executor = Executor(session)
    results = await executor.run(plan)

    await ChatRepo(db).touch_session(plan.session_id)

    return {"results": [r.__dict__ for r in results]}
