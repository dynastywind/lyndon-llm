"""ORM model for user-defined scheduled tasks (recurring cowork goals)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class ScheduledTask(Base):
    __tablename__ = "scheduled_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)

    # Schedule (simple presets) — "interval" | "daily" | "weekly"
    schedule_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    interval_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)  # interval
    time_of_day: Mapped[str | None] = mapped_column(String(5), nullable=True)  # "HH:MM" daily/weekly
    weekday: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0=Mon..6=Sun, weekly

    # Execution — "auto" runs every step; "auto_safe" drops high-risk steps
    acting_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="auto")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Bookkeeping
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    last_status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # ok|error|running
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )
