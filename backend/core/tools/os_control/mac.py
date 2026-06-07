"""macOS desktop-control driver — AppleScript (``osascript``) + system utilities."""

from __future__ import annotations

import asyncio

from config.settings import settings
from core.tools.base import ToolResult
from core.tools.os_control.base import OSDriver

_TOOL_NAME = "desktop_control"


def _quote(value: str) -> str:
    """Escape a string for safe interpolation inside an AppleScript double-quoted literal."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


class MacDriver(OSDriver):
    platform_label = "macOS"

    # --- low-level runners -------------------------------------------------

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
                return ToolResult(tool_name=_TOOL_NAME, success=True, output=out or "(done)")
            hint = self._perm_hint(err)
            error_msg = f"{err}\n\n{hint}" if hint else err
            return ToolResult(tool_name=_TOOL_NAME, success=False, output=None, error=error_msg)
        except TimeoutError:
            return self._err(f"AppleScript timed out after {t}s.")
        except Exception as e:  # noqa: BLE001
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
            stdout, stderr = await asyncio.wait_for(proc.communicate(input=stdin_data), timeout=t)
            out = stdout.decode(errors="replace").strip()
            err = stderr.decode(errors="replace").strip()
            if proc.returncode == 0:
                return ToolResult(tool_name=_TOOL_NAME, success=True, output=out or "(done)")
            hint = self._perm_hint(err)
            error_msg = f"{err}\n\n{hint}" if hint else err
            return ToolResult(tool_name=_TOOL_NAME, success=False, output=None, error=error_msg)
        except TimeoutError:
            return self._err(f"Command timed out after {t}s.")
        except Exception as e:  # noqa: BLE001
            return self._err(str(e))

    # --- apps --------------------------------------------------------------

    async def list_installed_apps(self) -> ToolResult:
        # List .app bundles in the two standard application directories.
        return await self._run_exec(
            "bash",
            "-lc",
            "ls -1 /Applications /Applications/Utilities 2>/dev/null | grep '\\.app$' | sort -u",
        )

    async def list_running_apps(self) -> ToolResult:
        script = (
            'tell application "System Events"\n'
            "    get name of every process whose background only is false\n"
            "end tell"
        )
        return await self._run_osascript(script)

    async def open_app(self, app_name: str | None = None) -> ToolResult:
        if not app_name:
            return self._err("'app_name' is required for open_app.")
        return await self._run_exec("open", "-a", app_name)

    async def quit_app(self, app_name: str | None = None) -> ToolResult:
        if not app_name:
            return self._err("'app_name' is required for quit_app.")
        return await self._run_osascript(f'tell application "{_quote(app_name)}" to quit')

    async def focus_app(self, app_name: str | None = None) -> ToolResult:
        if not app_name:
            return self._err("'app_name' is required for focus_app.")
        return await self._run_osascript(f'tell application "{_quote(app_name)}" to activate')

    # --- windows -----------------------------------------------------------

    async def list_windows(self, app_name: str | None = None) -> ToolResult:
        if app_name:
            safe = _quote(app_name)
            script = (
                'tell application "System Events" to tell process "'
                + safe
                + '" to get name of every window'
            )
        else:
            script = (
                'tell application "System Events" to get name of windows of '
                "(every process whose background only is false)"
            )
        return await self._run_osascript(script)

    async def focus_window(
        self, app_name: str | None = None, window_title: str | None = None
    ) -> ToolResult:
        if not app_name:
            return self._err("'app_name' is required for focus_window.")
        safe = _quote(app_name)
        target = (
            f'window "{_quote(window_title)}"' if window_title else "window 1"
        )
        script = (
            f'tell application "{safe}" to activate\n'
            'tell application "System Events" to tell process "' + safe + '"\n'
            f'    perform action "AXRaise" of {target}\n'
            "end tell"
        )
        return await self._run_osascript(script)

    async def move_window(
        self, app_name: str | None = None, x: int | None = None, y: int | None = None
    ) -> ToolResult:
        if not app_name or x is None or y is None:
            return self._err("'app_name', 'x' and 'y' are required for move_window.")
        safe = _quote(app_name)
        script = (
            'tell application "System Events" to tell process "' + safe + '"\n'
            f"    set position of window 1 to {{{int(x)}, {int(y)}}}\n"
            "end tell"
        )
        return await self._run_osascript(script)

    async def center_window(self, app_name: str | None = None) -> ToolResult:
        if not app_name:
            return self._err("'app_name' is required for center_window.")
        safe = _quote(app_name)
        # Center window 1 on the main display using its own size and the
        # desktop's visible bounds. `div` keeps the coordinates integral.
        script = (
            f'tell application "{safe}" to activate\n'
            'tell application "Finder" to set b to bounds of window of desktop\n'
            "set sw to item 3 of b\n"
            "set sh to item 4 of b\n"
            'tell application "System Events" to tell process "' + safe + '"\n'
            "    set {w, h} to size of window 1\n"
            "    set position of window 1 to {(sw - w) div 2, (sh - h) div 2}\n"
            "end tell"
        )
        return await self._run_osascript(script)

    async def resize_window(
        self, app_name: str | None = None, width: int | None = None, height: int | None = None
    ) -> ToolResult:
        if not app_name or width is None or height is None:
            return self._err("'app_name', 'width' and 'height' are required for resize_window.")
        safe = _quote(app_name)
        script = (
            'tell application "System Events" to tell process "' + safe + '"\n'
            f"    set size of window 1 to {{{int(width)}, {int(height)}}}\n"
            "end tell"
        )
        return await self._run_osascript(script)

    async def minimize_window(self, app_name: str | None = None) -> ToolResult:
        if not app_name:
            return self._err("'app_name' is required for minimize_window.")
        safe = _quote(app_name)
        script = (
            'tell application "System Events" to tell process "' + safe + '"\n'
            '    set value of attribute "AXMinimized" of window 1 to true\n'
            "end tell"
        )
        return await self._run_osascript(script)

    async def maximize_window(self, app_name: str | None = None) -> ToolResult:
        if not app_name:
            return self._err("'app_name' is required for maximize_window.")
        safe = _quote(app_name)
        # macOS has no true "maximize"; fill the desktop's visible bounds instead.
        script = (
            'tell application "Finder" to set b to bounds of window of desktop\n'
            "set w to item 3 of b\n"
            "set h to item 4 of b\n"
            'tell application "System Events" to tell process "' + safe + '"\n'
            "    set position of window 1 to {0, 22}\n"
            "    set size of window 1 to {w, (h - 22)}\n"
            "end tell"
        )
        return await self._run_osascript(script)

    async def close_window(self, app_name: str | None = None) -> ToolResult:
        if not app_name:
            return self._err("'app_name' is required for close_window.")
        safe = _quote(app_name)
        script = (
            'tell application "System Events" to tell process "' + safe + '"\n'
            '    perform action "AXPress" of '
            '(first button of window 1 whose subrole is "AXCloseButton")\n'
            "end tell"
        )
        return await self._run_osascript(script)

    # --- input -------------------------------------------------------------

    async def send_keystroke(
        self,
        app_name: str | None = None,
        key: str | None = None,
        modifiers: list[str] | None = None,
    ) -> ToolResult:
        if not app_name or not key:
            return self._err("'app_name' and 'key' are required for send_keystroke.")
        safe_app = _quote(app_name)
        safe_key = _quote(key)
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

    async def mouse_click(
        self, x: int | None = None, y: int | None = None, button: str = "left"
    ) -> ToolResult:
        if x is None or y is None:
            return self._err("'x' and 'y' are required for mouse_click.")
        if button == "right":
            down, up, btn = 3, 4, 1
        else:
            down, up, btn = 1, 2, 0
        # CoreGraphics event posting via pyobjc (preinstalled on most macOS Pythons).
        py = (
            "import Quartz,sys\n"
            f"p=({int(x)},{int(y)})\n"
            f"for ev in ({down},{up}):\n"
            f"    e=Quartz.CGEventCreateMouseEvent(None,ev,p,{btn})\n"
            "    Quartz.CGEventPost(Quartz.kCGHIDEventTap,e)\n"
        )
        result = await self._run_exec("python3", "-c", py)
        if not result.success and result.error and "No module named" in result.error:
            return self._err(
                "mouse_click needs the Quartz framework. Install it with "
                "`pip install pyobjc-framework-Quartz`, or use send_keystroke / run_script instead."
            )
        return result

    async def type_text(
        self, text: str | None = None, app_name: str | None = None
    ) -> ToolResult:
        if not text:
            return self._err("'text' is required for type_text.")
        safe_text = _quote(text)
        prefix = f'tell application "{_quote(app_name)}" to activate\n' if app_name else ""
        script = (
            prefix
            + 'tell application "System Events" to keystroke "'
            + safe_text
            + '"'
        )
        return await self._run_osascript(script)

    # --- screen / clipboard ------------------------------------------------

    async def screenshot(self, output_path: str | None = None) -> ToolResult:
        if not output_path:
            return self._err("'output_path' is required for screenshot.")
        return await self._run_exec("screencapture", "-x", output_path)

    async def get_clipboard(self) -> ToolResult:
        return await self._run_exec("pbpaste")

    async def set_clipboard(self, content: str | None = None) -> ToolResult:
        if content is None:
            return self._err("'content' is required for set_clipboard.")
        return await self._run_exec("pbcopy", stdin_data=content.encode())

    # --- app tasks ---------------------------------------------------------

    async def create_note(
        self, title: str | None = None, body: str | None = None
    ) -> ToolResult:
        if not title and not body:
            return self._err("create_note needs at least a 'title' or 'body'.")
        # Notes renders the body as HTML; the first line becomes the title, so
        # prepend the title as a heading. Use 'with properties {body:…}' which is
        # the reliable, account-default way to create a visible note.
        title = title or "New Note"
        html_body = f"<div><b>{_quote(title)}</b></div>"
        if body:
            html_body += f"<div>{_quote(body)}</div>"
        script = (
            'tell application "Notes" to make new note with properties {body:"'
            + html_body
            + '"}'
        )
        result = await self._run_osascript(script)
        if result.success:
            return ToolResult(
                tool_name=_TOOL_NAME, success=True, output=f"Note '{title}' created in Notes."
            )
        return result

    # --- escape hatch ------------------------------------------------------

    async def run_script(self, script: str | None = None) -> ToolResult:
        if not script:
            return self._err("'script' is required for run_script.")
        return await self._run_osascript(script)
