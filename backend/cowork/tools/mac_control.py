"""
Deprecated alias for ``desktop_control`` on macOS.

Kept so existing chat history and saved prompts that reference ``mac_control``
keep working. It maps the original 8-action vocabulary onto the cross-platform
:class:`OSControlTool`. Prefer ``desktop_control`` for new work.
"""

from __future__ import annotations

from typing import Any

from core.permissions.gate import Permission, require_permission
from core.tools.base import ToolResult
from core.tools.risk import RiskTier
from cowork.tools.os_control import OSControlTool

# Legacy action → (new action, risk) mapping.
_LEGACY_RISK: dict[str, RiskTier] = {
    "run_applescript": RiskTier.DANGEROUS,
    "list_apps": RiskTier.SAFE,
    "focus_app": RiskTier.SENSITIVE,
    "send_keystroke": RiskTier.DANGEROUS,
    "click_menu_item": RiskTier.DANGEROUS,
    "take_screenshot": RiskTier.SAFE,
    "get_clipboard": RiskTier.SAFE,
    "set_clipboard": RiskTier.SENSITIVE,
}


def _quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


class MacControlTool(OSControlTool):
    name = "mac_control"
    description = "(Deprecated — use desktop_control.) Control macOS via AppleScript and utilities."

    @require_permission(Permission.EXEC)
    async def run(  # type: ignore[override]
        self,
        action: str,
        script: str | None = None,
        app_name: str | None = None,
        key: str | None = None,
        modifiers: list[str] | None = None,
        menu_path: list[str] | None = None,
        output_path: str | None = None,
        content: str | None = None,
    ) -> ToolResult:
        driver = self._driver()
        if driver is None:
            return ToolResult(
                tool_name=self.name, success=False, output=None, error="Unsupported platform."
            )
        match action:
            case "run_applescript":
                return await driver.run_script(script=script)
            case "list_apps":
                return await driver.list_running_apps()
            case "focus_app":
                return await driver.focus_app(app_name=app_name)
            case "send_keystroke":
                return await driver.send_keystroke(app_name=app_name, key=key, modifiers=modifiers)
            case "click_menu_item":
                return await self._click_menu_item(driver, app_name, menu_path)
            case "take_screenshot":
                return await driver.screenshot(output_path=output_path)
            case "get_clipboard":
                return await driver.get_clipboard()
            case "set_clipboard":
                return await driver.set_clipboard(content=content)
            case _:
                return ToolResult(
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Unknown action '{action}'.",
                )

    async def _click_menu_item(
        self, driver: Any, app_name: str | None, menu_path: list[str] | None
    ) -> ToolResult:
        if not app_name or not menu_path or len(menu_path) < 2:
            return ToolResult(
                tool_name=self.name,
                success=False,
                output=None,
                error="'app_name' and 'menu_path' (>=2 items) are required for click_menu_item.",
            )
        safe_app = _quote(app_name)
        menu = _quote(menu_path[0])
        item = _quote(menu_path[-1])
        script = (
            f'tell application "{safe_app}" to activate\n'
            'tell application "System Events"\n'
            f'    tell process "{safe_app}"\n'
            f'        click menu item "{item}" of menu "{menu}"'
            f' of menu bar item "{menu}" of menu bar 1\n'
            "    end tell\n"
            "end tell"
        )
        return await driver.run_script(script=script)

    def risk_for(self, args: dict[str, Any]) -> RiskTier:
        return _LEGACY_RISK.get(args.get("action", ""), RiskTier.DANGEROUS)

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "run_applescript",
                            "list_apps",
                            "focus_app",
                            "send_keystroke",
                            "click_menu_item",
                            "take_screenshot",
                            "get_clipboard",
                            "set_clipboard",
                        ],
                        "description": "The macOS automation action to perform.",
                    },
                    "script": {
                        "type": "string",
                        "description": "Raw AppleScript code (run_applescript only).",
                    },
                    "app_name": {"type": "string", "description": "Target application name."},
                    "key": {
                        "type": "string",
                        "description": "Key to press, e.g. 'return', 'tab', 's'.",
                    },
                    "modifiers": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Modifier keys: command, option, shift, control.",
                    },
                    "menu_path": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Menu hierarchy, e.g. ['File', 'Save As…'].",
                    },
                    "output_path": {
                        "type": "string",
                        "description": "Destination file path for screenshot (take_screenshot only).",
                    },
                    "content": {
                        "type": "string",
                        "description": "Text to place on the clipboard (set_clipboard only).",
                    },
                },
                "required": ["action"],
            },
        }
