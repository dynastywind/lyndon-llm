"""ORM model for user accounts."""

from __future__ import annotations

from datetime import UTC, datetime
import uuid

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    hashed_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # OAuth fields — set for users who signed in via a third-party provider
    oauth_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)  # e.g. "google"
    oauth_sub: Mapped[str | None] = mapped_column(String(256), nullable=True)  # provider user ID
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )
