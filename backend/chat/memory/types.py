"""
Memory types used across short-term and long-term memory systems.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
import uuid

from pydantic import BaseModel, Field


class MemoryType(str, Enum):
    EPISODIC    = "episodic"    # "On May 20, user asked about Vercel setup"
    SEMANTIC    = "semantic"    # "User prefers Python, dislikes verbose logging"
    PROCEDURAL  = "procedural"  # "Steps user uses to deploy this project"


class Memory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    memory_type: MemoryType
    content: str
    importance: float = 0.5         # 0.0 – 1.0, higher = keep longer
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_accessed: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    access_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)
    embedding: list[float] | None = None  # populated lazily

    def touch(self) -> None:
        self.last_accessed = datetime.now(timezone.utc)
        self.access_count += 1


class ConversationTurn(BaseModel):
    role: str       # "user" | "assistant" | "tool"
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    tool_name: str | None = None
    token_count: int = 0
