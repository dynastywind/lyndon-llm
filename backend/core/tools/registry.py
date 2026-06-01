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
            Mode.CHAT: {},
            Mode.COWORK: {},
            Mode.CODE: {},
        }
        self._mcp_registry: dict[Mode, dict[str, type[BaseTool]]] = {
            Mode.CHAT: {},
            Mode.COWORK: {},
            Mode.CODE: {},
        }

    def register(self, mode: Mode, tool_cls: type[BaseTool]) -> None:
        """Register a built-in tool class for a given mode."""
        assert tool_cls.name, f"{tool_cls.__name__} must set a `name` class attribute"
        self._registry[mode][tool_cls.name] = tool_cls

    def register_mcp(self, mode: Mode, tool_cls: type[BaseTool]) -> None:
        """Register a dynamic MCP-backed tool."""
        assert tool_cls.name
        self._mcp_registry[mode][tool_cls.name] = tool_cls

    def unregister_mcp(self, mode: Mode, tool_name: str) -> None:
        self._mcp_registry[mode].pop(tool_name, None)

    def clear_mcp(self, mode: Mode) -> None:
        self._mcp_registry[mode].clear()

    def _all_classes(self, mode: Mode) -> dict[str, type[BaseTool]]:
        merged = dict(self._registry[mode])
        merged.update(self._mcp_registry[mode])
        return merged

    def get_tools(
        self, mode: Mode, gate: PermissionGate, user_id: str | None = None
    ) -> dict[str, BaseTool]:
        """Return instantiated tools for the given mode (internal + MCP)."""
        return {name: cls(gate, user_id=user_id) for name, cls in self._all_classes(mode).items()}

    def get_openai_schemas(self, mode: Mode) -> list[dict]:
        """Return OpenAI-format tool schemas for the given mode (for LLM function calling)."""
        dummy_gate = PermissionGate(mode)
        return [cls(dummy_gate).to_openai_tool() for cls in self._all_classes(mode).values()]

    def list_tool_names(self, mode: Mode) -> list[str]:
        return list(self._all_classes(mode).keys())

    def list_internal_tools(self, mode: Mode) -> list[dict]:
        """Metadata for built-in tools (Settings UI — not editable)."""
        dummy_gate = PermissionGate(mode)
        return [
            {
                "name": cls.name,
                "description": cls.description or cls(dummy_gate).schema().get("description", ""),
                "permission": cls.permission.value,
                "mode": mode.value,
                "source": "internal",
                "editable": False,
            }
            for cls in self._registry[mode].values()
        ]


# Module-level singleton
tool_registry = ToolRegistry()
