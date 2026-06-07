"""
BaseTool — all tools across Chat, Cowork, and Code implement this interface.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from core.permissions.gate import Permission, PermissionGate

if TYPE_CHECKING:
    from core.tools.risk import RiskTier


class ToolResult(BaseModel):
    tool_name: str
    success: bool
    output: Any
    error: str | None = None


class BaseTool(ABC):
    """
    Abstract base class for all tools.

    Subclasses must:
      - Set `name` and `description` class attributes
      - Set `permission` to declare the required permission level
      - Implement `run(**kwargs) -> ToolResult`
      - Implement `schema() -> dict` returning an OpenAI-compatible tool schema
    """

    name: str = ""
    description: str = ""
    permission: Permission = Permission.READ

    def __init__(self, gate: PermissionGate, user_id: str | None = None) -> None:
        self.gate = gate
        self.user_id = user_id

    @abstractmethod
    async def run(self, **kwargs: Any) -> ToolResult:
        """Execute the tool. Gate check is done in @require_permission decorator."""
        ...

    @abstractmethod
    def schema(self) -> dict[str, Any]:
        """Return OpenAI function-calling schema for this tool."""
        ...

    def to_openai_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": self.schema(),
        }

    def risk_for(self, args: dict[str, Any]) -> RiskTier | None:
        """
        Per-call risk tier consulted by the approval gate.

        Return ``None`` (the default) to use the coarse session-wide approval
        behavior. Override to classify a call (e.g. by its ``action``) so the
        engine can pause only for sensitive/dangerous operations.
        """
        return None
