"""
Tool Registry — central catalogue of all available tools, tagged by mode.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from core.permissions.gate import Mode, PermissionGate

if TYPE_CHECKING:
    from core.tools.base import BaseTool


class ToolRegistry:
    """
    Maps tool names to their classes, grouped by mode.
    At runtime, instantiate tools with the active session's PermissionGate.
    """

    def __init__(self) -> None:
        # mode → {tool_name → tool_class}
        self._registry: dict[Mode, dict[str, type[BaseTool]]] = {
            Mode.CHAT:   {},
            Mode.COWORK: {},
            Mode.CODE:   {},
        }

    def register(self, mode: Mode, tool_cls: type[BaseTool]) -> None:
        """Register a tool class for a given mode."""
        assert tool_cls.name, f"{tool_cls.__name__} must set a `name` class attribute"
        self._registry[mode][tool_cls.name] = tool_cls

    def get_tools(self, mode: Mode, gate: PermissionGate) -> dict[str, BaseTool]:
        """Return instantiated tools for the given mode."""
        return {
            name: cls(gate)
            for name, cls in self._registry[mode].items()
        }

    def get_openai_schemas(self, mode: Mode) -> list[dict]:
        """Return OpenAI-format tool schemas for the given mode (for LLM function calling)."""
        # Instantiate with a permissive gate just to call schema()
        dummy_gate = PermissionGate(mode)
        return [
            cls(dummy_gate).to_openai_tool()
            for cls in self._registry[mode].values()
        ]

    def list_tool_names(self, mode: Mode) -> list[str]:
        return list(self._registry[mode].keys())


# Module-level singleton
tool_registry = ToolRegistry()
