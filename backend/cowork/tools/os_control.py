"""
Cross-platform desktop-control tool — Cowork/Code modes only, requires EXEC.

Exposes one platform-neutral action surface to the LLM and dispatches each call
to the driver for the host OS (``MacDriver`` today, ``WindowsDriver`` later).
Per-action risk tiers (see :meth:`risk_for`) let the approval gate prompt only
for sensitive/dangerous operations.
"""

from __future__ import annotations

import platform
from typing import Any

from core.permissions.gate import Permission, require_permission
from core.tools.base import BaseTool, ToolResult
from core.tools.os_control.base import ACTION_RISK, OS_CONTROL_ACTIONS, OSDriver
from core.tools.os_control.mac import MacDriver
from core.tools.os_control.windows import WindowsDriver
from core.tools.risk import RiskTier


class OSControlTool(BaseTool):
    name = "desktop_control"
    description = (
        "Control the desktop operating system. Manage applications (list, open, quit, focus), "
        "windows (list, focus, move, resize, minimize, maximize, close), input (keystrokes, "
        "mouse clicks, typing), the screen (screenshot), and the clipboard. Works on the host's "
        "OS. Prefer this over raw shell commands for any application or window control."
    )
    permission = Permission.EXEC

    def _driver(self) -> OSDriver | None:
        sysname = platform.system()
        if sysname == "Darwin":
            return MacDriver()
        if sysname == "Windows":
            return WindowsDriver()
        return None

    @require_permission(Permission.EXEC)
    async def run(self, action: str, **kwargs: Any) -> ToolResult:  # type: ignore[override]
        driver = self._driver()
        if driver is None:
            return ToolResult(
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Desktop control is not supported on '{platform.system()}'.",
            )
        return await driver.dispatch(action, **kwargs)

    def risk_for(self, args: dict[str, Any]) -> RiskTier:
        # Unknown actions default to the safest-to-gate tier so they always prompt.
        return ACTION_RISK.get(args.get("action", ""), RiskTier.DANGEROUS)

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": list(OS_CONTROL_ACTIONS),
                        "description": "The desktop-control action to perform.",
                    },
                    "app_name": {
                        "type": "string",
                        "description": "Target application name (apps and window actions).",
                    },
                    "window_title": {
                        "type": "string",
                        "description": "Window title to target (focus_window). Defaults to the frontmost window.",
                    },
                    "x": {
                        "type": "integer",
                        "description": "X coordinate (move_window, mouse_click).",
                    },
                    "y": {
                        "type": "integer",
                        "description": "Y coordinate (move_window, mouse_click).",
                    },
                    "width": {"type": "integer", "description": "Window width (resize_window)."},
                    "height": {"type": "integer", "description": "Window height (resize_window)."},
                    "button": {
                        "type": "string",
                        "enum": ["left", "right"],
                        "description": "Mouse button (mouse_click). Defaults to left.",
                    },
                    "key": {
                        "type": "string",
                        "description": "Key to press, e.g. 'return', 'tab', 's' (send_keystroke).",
                    },
                    "modifiers": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Modifier keys: command, option, shift, control (send_keystroke).",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type into the focused field (type_text).",
                    },
                    "output_path": {
                        "type": "string",
                        "description": "Destination file path for the screenshot (screenshot).",
                    },
                    "content": {
                        "type": "string",
                        "description": "Text to place on the clipboard (set_clipboard).",
                    },
                    "title": {
                        "type": "string",
                        "description": "Note title (create_note).",
                    },
                    "body": {
                        "type": "string",
                        "description": "Note body text (create_note).",
                    },
                    "script": {
                        "type": "string",
                        "description": "Raw platform script — AppleScript on macOS (run_script).",
                    },
                },
                "required": ["action"],
            },
        }
