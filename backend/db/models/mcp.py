"""ORM models for user-registered MCP servers and cached tool metadata."""

from __future__ import annotations

from datetime import UTC, datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class McpServer(Base):
    __tablename__ = "mcp_servers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # stdio | sse
    transport: Mapped[str] = mapped_column(String(16), nullable=False, default="stdio")
    command: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # JSON array of strings
    args_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # JSON object string -> string
    env_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    tools: Mapped[list[McpToolCache]] = relationship(
        back_populates="server",
        cascade="all, delete-orphan",
    )


class McpToolCache(Base):
    """Tool metadata discovered from an MCP server (refreshed on connect)."""

    __tablename__ = "mcp_tool_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    server_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("mcp_servers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Original name on the MCP server
    mcp_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # Qualified name exposed to the LLM: mcp__{server_id}__{mcp_name}
    qualified_name: Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    input_schema_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    server: Mapped[McpServer] = relationship(back_populates="tools")
