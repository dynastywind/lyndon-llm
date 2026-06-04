"""ORM models for user-installed skills and their tool definitions."""

from __future__ import annotations

from datetime import UTC, datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[str] = mapped_column(String(32), nullable=False, default="1.0")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    skill_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    tools: Mapped[list[SkillTool]] = relationship(
        back_populates="skill",
        cascade="all, delete-orphan",
    )


class SkillTool(Base):
    """A single invocable tool defined within a skill bundle."""

    __tablename__ = "skill_tools"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    skill_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    language: Mapped[str] = mapped_column(String(32), nullable=False)
    script_content: Mapped[str] = mapped_column(Text, nullable=False)
    # JSON: OpenAI function-calling parameters object {"type":"object","properties":{...},"required":[...]}
    parameters_schema_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")

    skill: Mapped[Skill] = relationship(back_populates="tools")
