"""
SQLAlchemy ORM model for projects.

A project groups chat sessions under a shared brief (``instructions``) and
shared context (uploaded RAG files scoped by ``project_id`` plus on-disk folder
references in ``folders_json``).  Projects are scoped to a single ``mode``
(chat / cowork / code) and a single user.
"""

from __future__ import annotations

from datetime import UTC, datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Owning mode — a project only ever holds sessions of this mode.
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="chat")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Shared brief; doubles as the card description in the UI. Null until set.
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON array of {path, name} on-disk folder references (cowork/code working dirs).
    folders_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
