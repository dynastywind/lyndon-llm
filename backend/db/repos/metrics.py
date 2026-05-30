"""
CRUD operations for LLM performance metrics.
"""
from __future__ import annotations

import json
import statistics
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.metrics import ChatMetric


class MetricsRepo:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def add(
        self,
        session_id: str | None,
        total_ms: int,
        phases: dict,
        route: str | None = None,
    ) -> ChatMetric:
        row = ChatMetric(
            session_id=session_id,
            route=route,
            total_ms=total_ms,
            phases_json=json.dumps(phases),
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def list(
        self,
        limit: int = 100,
        offset: int = 0,
        session_id: str | None = None,
    ) -> tuple[list[ChatMetric], int]:
        q = select(ChatMetric)
        if session_id:
            q = q.where(ChatMetric.session_id == session_id)

        total: int = (
            await self._db.execute(
                select(func.count()).select_from(q.subquery())
            )
        ).scalar_one()

        rows = list(
            (
                await self._db.execute(
                    q.order_by(ChatMetric.created_at.desc())
                    .limit(limit)
                    .offset(offset)
                )
            ).scalars()
        )
        return rows, total

    @staticmethod
    def to_dict(row: ChatMetric) -> dict:
        from datetime import timezone
        dt = row.created_at
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return {
            "id":         row.id,
            "session_id": row.session_id,
            "created_at": dt.isoformat(),
            "route":      row.route,
            "total_ms":   row.total_ms,
            "phases":     json.loads(row.phases_json) if row.phases_json else {},
        }

    @staticmethod
    def summary(rows: list[ChatMetric]) -> dict:
        """Compute aggregate stats over a list of rows."""
        if not rows:
            return {"count": 0}
        totals = [r.total_ms for r in rows]
        ttfts  = [
            json.loads(r.phases_json).get("ttft_ms")
            for r in rows
            if r.phases_json
        ]
        ttfts = [v for v in ttfts if v is not None]
        sorted_totals = sorted(totals)
        p = lambda lst, pct: lst[int(len(lst) * pct / 100)] if lst else None  # noqa: E731
        return {
            "count":        len(rows),
            "avg_total_ms": round(statistics.mean(totals)),
            "p50_total_ms": p(sorted_totals, 50),
            "p90_total_ms": p(sorted_totals, 90),
            "min_total_ms": min(totals),
            "max_total_ms": max(totals),
            "avg_ttft_ms":  round(statistics.mean(ttfts)) if ttfts else None,
            "p90_ttft_ms":  p(sorted(ttfts), 90) if ttfts else None,
        }
