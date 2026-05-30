from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_db
from db.repos.metrics import MetricsRepo

router = APIRouter()


@router.get("")
async def get_metrics(
    limit:      int            = Query(default=100, ge=1,  le=500),
    offset:     int            = Query(default=0,   ge=0),
    session_id: Optional[str]  = Query(default=None),
    db: AsyncSession           = Depends(get_db),
):
    """
    Return recent LLM performance metrics, newest-first.
    Also includes aggregate summary stats over the returned slice.
    """
    repo = MetricsRepo(db)
    rows, total = await repo.list(limit=limit, offset=offset, session_id=session_id)
    return {
        "metrics": [repo.to_dict(r) for r in rows],
        "total":   total,
        "summary": repo.summary(rows),
    }
