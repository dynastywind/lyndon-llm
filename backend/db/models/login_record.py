"""ORM model for user login audit records."""

from __future__ import annotations

from datetime import UTC, datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class LoginRecord(Base):
    __tablename__ = "login_records"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Client-generated persistent identifier stored in localStorage
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Derived from User-Agent: macos | windows | linux | ios | android | unknown
    os: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    # Derived from User-Agent: chrome | safari | edge | firefox | tauri | unknown
    browser: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    # Raw User-Agent string
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Client IP address
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, index=True
    )
