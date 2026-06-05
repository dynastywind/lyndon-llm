"""macOS application control tool — Cowork/Code modes only, requires EXEC permission."""

from __future__ import annotations

import asyncio
from typing import Any

from config.settings import settings
from core.permissions.gate import Permission, require_permission
from core.tools.base import BaseTool, ToolResult

_PERM_HINTS: dict[str, str] = {
    "assistive access": (
        "Grant Accessibility permission: System Settings › Privacy & Security › Accessibility."
    ),
    "send keystrokes": (
        "Grant Accessibility permission: System Settings › Privacy & Security › Accessibility."
    ),
    "send Apple events": (
        "Grant Automation permission: System Settings › Privacy & Security › Automation."
    ),
    "screen capture": (
        "Grant Screen Recording permission: System Settings › Privacy & Security › Screen Recording."
    ),
}


class MacControlTool(BaseTool):
    name = "mac_control"
    description = (
        "Control macOS applications using AppleScript and system utilities. "
        "Can launch/focus apps, send keystrokes, click menus, take screenshots, "
        "and read/write the clipboard."
    )
    permission = Permission.EXEC

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
        match action:
            case "run_applescript":
                if not script:
                    return self._err("'script' is required for run_applescript.")
                return await self._run_osascript(script)
            case "list_apps":
                return await self._list_apps()
            case "focus_app":
                if not app_name:
                    return self._err("'app_name' is required for focus_app.")
                return await self._focus_app(app_name)
            case "send_keystroke":
                if not app_name or not key:
                    return self._err("'app_name' and 'key' are required for send_keystroke.")
                return await self._send_keystroke(app_name, key, modifiers or [])
            case "click_menu_item":
                if not app_name or not menu_path or len(menu_path) < 2:
                    return self._err(
                        "'app_name' and 'menu_path' (≥2 items) are required for click_menu_item."
                    )
                return await self._click_menu_item(app_name, menu_path)
            case "take_screenshot":
                if not output_path:
                    return self._err("'output_path' is required for take_screenshot.")
                return await self._take_screenshot(output_path)
            case "get_clipboard":
                return await self._get_clipboard()
            case "set_clipboard":
                if content is None:
                    return self._err("'content' is required for set_clipboard.")
                return await self._set_clipboard(content)
            case _:
                return self._err(f"Unknown action '{action}'.")

    # --- private helpers ---------------------------------------------------

    def _err(self, msg: str) -> ToolResult:
        return ToolResult(tool_name=self.name, success=False, output=None, error=msg)

    def _perm_hint(self, stderr_text: str) -> str:
        for keyword, hint in _PERM_HINTS.items():
            if keyword in stderr_text:
                return hint
        return ""

    async def _run_osascript(self, script: str) -> ToolResult:
        t = settings.mac_control_timeout
        try:
            proc = await asyncio.create_subprocess_exec(
                "osascript",
                "-e",
                script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=t)
            out = stdout.decode(errors="replace").strip()
            err = stderr.decode(errors="replace").strip()
            if proc.returncode == 0:
                return ToolResult(tool_name=self.name, success=True, output=out or "(done)")
            hint = self._perm_hint(err)
            error_msg = f"{err}\n\n{hint}" if hint else err
            return ToolResult(tool_name=self.name, success=False, output=None, error=error_msg)
        except TimeoutError:
            return self._err(f"AppleScript timed out after {t}s.")
        except Exception as e:
            return self._err(str(e))

    async def _run_exec(self, *args: str, stdin_data: bytes | None = None) -> ToolResult:
        t = settings.mac_control_timeout
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE if stdin_data is not None else None,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=stdin_data), timeout=t
            )
            out = stdout.decode(errors="replace").strip()
            err = stderr.decode(errors="replace").strip()
            if proc.returncode == 0:
                return ToolResult(tool_name=self.name, success=True, output=out or "(done)")
            hint = self._perm_hint(err)
            error_msg = f"{err}\n\n{hint}" if hint else err
            return ToolResult(tool_name=self.name, success=False, output=None, error=error_msg)
        except TimeoutError:
            return self._err(f"Command timed out after {t}s.")
        except Exception as e:
            return self._err(str(e))

    async def _list_apps(self) -> ToolResult:
        script = (
            'tell application "System Events"\n'
            "    get name of every process whose background only is false\n"
            "end tell"
        )
        return await self._run_osascript(script)

    async def _focus_app(self, app_name: str) -> ToolResult:
        safe = app_name.replace('"', '\\"')
        return await self._run_osascript(f'tell application "{safe}" to activate')

    async def _send_keystroke(
        self, app_name: str, key: str, modifiers: list[str]
    ) -> ToolResult:
        safe_app = app_name.replace('"', '\\"')
        safe_key = key.replace('"', '\\"')
        if modifiers:
            mod_str = "{" + ", ".join(f"{m} down" for m in modifiers) + "}"
            keystroke_line = f'keystroke "{safe_key}" using {mod_str}'
        else:
            keystroke_line = f'keystroke "{safe_key}"'
        script = (
            f'tell application "{safe_app}" to activate\n'
            'tell application "System Events"\n'
            f'    tell process "{safe_app}"\n'
            f"        {keystroke_line}\n"
            "    end tell\n"
            "end tell"
        )
        return await self._run_osascript(script)

    async def _click_menu_item(self, app_name: str, menu_path: list[str]) -> ToolResult:
        safe_app = app_name.replace('"', '\\"')
        menu = menu_path[0].replace('"', '\\"')
        item = menu_path[-1].replace('"', '\\"')
        # For paths deeper than 2, the caller should use run_applescript directly.
        script = (
            f'tell application "{safe_app}" to activate\n'
            'tell application "System Events"\n'
            f'    tell process "{safe_app}"\n'
            f'        click menu item "{item}" of menu "{menu}"'
            f' of menu bar item "{menu}" of menu bar 1\n'
            "    end tell\n"
            "end tell"
        )
        return await self._run_osascript(script)

    async def _take_screenshot(self, output_path: str) -> ToolResult:
        return await self._run_exec("screencapture", "-x", output_path)

    async def _get_clipboard(self) -> ToolResult:
        return await self._run_exec("pbpaste")

    async def _set_clipboard(self, content: str) -> ToolResult:
        return await self._run_exec("pbcopy", stdin_data=content.encode())

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
                    "app_name": {
                        "type": "string",
                        "description": "Target application name.",
                    },
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
