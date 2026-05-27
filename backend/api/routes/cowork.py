from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_session
from cowork.executor import Executor
from cowork.planner import Plan, Planner
from core.session.manager import Session

router = APIRouter()
_planner = Planner()
_active_plans: dict[str, Plan] = {}   # plan_id → Plan (in-memory, replace with DB)


class GoalRequest(BaseModel):
    goal: str


class ApproveRequest(BaseModel):
    plan_id: str


@router.post("/plan")
async def create_plan(body: GoalRequest, session: Session = Depends(get_session)):
    plan = await _planner.create_plan(body.goal, session_id=session.session_id)
    _active_plans[plan.plan_id] = plan
    return {
        "plan_id": plan.plan_id,
        "display": _planner.format_plan_for_display(plan),
        "steps": [s.model_dump() for s in plan.steps],
    }


@router.post("/execute")
async def execute_plan(body: ApproveRequest, session: Session = Depends(get_session)):
    plan = _active_plans.get(body.plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")

    plan.approved = True
    executor = Executor(session)
    results = await executor.run(plan)
    return {"results": [r.__dict__ for r in results]}
