"""
ORM model for per-request LLM performance metrics.
"""

from __future__ import annotations

from datetime import UTC, datetime
import uuid

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class ChatMetric(Base):
    __tablename__ = "chat_metrics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    route: Mapped[str | None] = mapped_column(String(32), nullable=True)  # direct|rag|tools|…
    total_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    # JSON object: {"route_ms": 12, "search_ms": 843, "ttft_ms": 2685, …}
    phases_json: Mapped[str | None] = mapped_column(Text, nullable=True)
