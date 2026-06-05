"""ORM model for persisting cowork plans across server restarts."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class CoworkPlan(Base):
    __tablename__ = "cowork_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # = plan_id
    session_id: Mapped[str] = mapped_column(String(255), nullable=False, default="", index=True)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    steps_json: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array of PlanStep dicts
    approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
