from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_session
from core.session.manager import Session
from cowork.executor import Executor
from cowork.planner import Plan, Planner, PlanStep
from db.base import get_db
from db.models.cowork import CoworkPlan as CoworkPlanRow

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
):
    plan = await _planner.create_plan(body.goal, session_id=session.session_id)
    row = CoworkPlanRow(
        id=plan.plan_id,
        session_id=plan.session_id,
        goal=plan.goal,
        steps_json=json.dumps([s.model_dump() for s in plan.steps]),
        approved=False,
    )
    db.add(row)
    await db.commit()
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
            404, "Plan not found — it may have been created in a previous session. Please create a new plan."
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
    return {"results": [r.__dict__ for r in results]}
