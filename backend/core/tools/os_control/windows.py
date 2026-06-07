"""
Windows desktop-control driver — placeholder.

Implements the :class:`OSDriver` interface so ``OSControlTool`` can dispatch on
Windows hosts, but every action currently reports that Windows support is not
ready yet. A future implementation will back these with PowerShell / pywinauto.
"""

from __future__ import annotations

from core.tools.base import ToolResult
from core.tools.os_control.base import OSDriver


class WindowsDriver(OSDriver):
    platform_label = "Windows"

    # Apps
    async def list_installed_apps(self) -> ToolResult:
        return self._unsupported("list_installed_apps")

    async def list_running_apps(self) -> ToolResult:
        return self._unsupported("list_running_apps")

    async def open_app(self, app_name: str | None = None) -> ToolResult:
        return self._unsupported("open_app")

    async def quit_app(self, app_name: str | None = None) -> ToolResult:
        return self._unsupported("quit_app")

    async def focus_app(self, app_name: str | None = None) -> ToolResult:
        return self._unsupported("focus_app")

    # Windows
    async def list_windows(self, app_name: str | None = None) -> ToolResult:
        return self._unsupported("list_windows")

    async def focus_window(
        self, app_name: str | None = None, window_title: str | None = None
    ) -> ToolResult:
        return self._unsupported("focus_window")

    async def move_window(
        self, app_name: str | None = None, x: int | None = None, y: int | None = None
    ) -> ToolResult:
        return self._unsupported("move_window")

    async def center_window(self, app_name: str | None = None) -> ToolResult:
        return self._unsupported("center_window")

    async def resize_window(
        self, app_name: str | None = None, width: int | None = None, height: int | None = None
    ) -> ToolResult:
        return self._unsupported("resize_window")

    async def minimize_window(self, app_name: str | None = None) -> ToolResult:
        return self._unsupported("minimize_window")

    async def maximize_window(self, app_name: str | None = None) -> ToolResult:
        return self._unsupported("maximize_window")

    async def close_window(self, app_name: str | None = None) -> ToolResult:
        return self._unsupported("close_window")

    # Input
    async def send_keystroke(
        self,
        app_name: str | None = None,
        key: str | None = None,
        modifiers: list[str] | None = None,
    ) -> ToolResult:
        return self._unsupported("send_keystroke")

    async def mouse_click(
        self, x: int | None = None, y: int | None = None, button: str = "left"
    ) -> ToolResult:
        return self._unsupported("mouse_click")

    async def type_text(self, text: str | None = None, app_name: str | None = None) -> ToolResult:
        return self._unsupported("type_text")

    # Screen / clipboard
    async def screenshot(self, output_path: str | None = None) -> ToolResult:
        return self._unsupported("screenshot")

    async def get_clipboard(self) -> ToolResult:
        return self._unsupported("get_clipboard")

    async def set_clipboard(self, content: str | None = None) -> ToolResult:
        return self._unsupported("set_clipboard")

    # Escape hatch
    async def run_script(self, script: str | None = None) -> ToolResult:
        return self._unsupported("run_script")
