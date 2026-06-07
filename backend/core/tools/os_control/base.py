"""
``OSDriver`` — the platform-neutral desktop-control action surface.

Every supported OS implements this interface; ``OSControlTool`` selects the
driver at runtime via ``platform.system()`` and calls :meth:`OSDriver.dispatch`.
Each action returns a ``ToolResult`` so the engine handles success/error the
same way it does for every other tool.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
import inspect

from core.tools.base import ToolResult
from core.tools.risk import RiskTier

# Permission hints surfaced when the OS denies an automation request. Shared by
# all drivers (the keywords are macOS-flavored today; Windows can extend this).
PERM_HINTS: dict[str, str] = {
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

# The complete neutral action surface, in the order shown to the model.
OS_CONTROL_ACTIONS: tuple[str, ...] = (
    # Apps
    "list_installed_apps",
    "list_running_apps",
    "open_app",
    "quit_app",
    "focus_app",
    # Windows
    "list_windows",
    "focus_window",
    "move_window",
    "center_window",
    "resize_window",
    "minimize_window",
    "maximize_window",
    "close_window",
    # Input
    "send_keystroke",
    "mouse_click",
    "type_text",
    # Screen / clipboard
    "screenshot",
    "get_clipboard",
    "set_clipboard",
    # Escape hatch
    "run_script",
)

# Per-action risk classification consulted by the approval gate.
ACTION_RISK: dict[str, RiskTier] = {
    # SAFE — read-only
    "list_installed_apps": RiskTier.SAFE,
    "list_running_apps": RiskTier.SAFE,
    "list_windows": RiskTier.SAFE,
    "get_clipboard": RiskTier.SAFE,
    "screenshot": RiskTier.SAFE,
    # SENSITIVE — reversible state change
    "open_app": RiskTier.SENSITIVE,
    "focus_app": RiskTier.SENSITIVE,
    "focus_window": RiskTier.SENSITIVE,
    "move_window": RiskTier.SENSITIVE,
    "center_window": RiskTier.SENSITIVE,
    "resize_window": RiskTier.SENSITIVE,
    "minimize_window": RiskTier.SENSITIVE,
    "maximize_window": RiskTier.SENSITIVE,
    "set_clipboard": RiskTier.SENSITIVE,
    # DANGEROUS — arbitrary or irreversible
    "quit_app": RiskTier.DANGEROUS,
    "close_window": RiskTier.DANGEROUS,
    "send_keystroke": RiskTier.DANGEROUS,
    "mouse_click": RiskTier.DANGEROUS,
    "type_text": RiskTier.DANGEROUS,
    "run_script": RiskTier.DANGEROUS,
}


class OSDriver(ABC):
    """Abstract per-OS desktop-control backend."""

    #: Human-readable platform label used in error messages.
    platform_label: str = "this platform"

    async def dispatch(self, action: str, **kwargs: object) -> ToolResult:
        """Route a neutral action name to the matching driver method.

        Arguments the chosen handler does not accept are dropped: the schema
        advertises every parameter at the top level, so models routinely attach
        irrelevant ones (e.g. ``x``/``y`` on ``open_app``). Silently ignoring
        extras keeps a single over-supplied call from failing.
        """
        handler = getattr(self, action, None)
        if handler is None or action not in OS_CONTROL_ACTIONS:
            return self._err(f"Unknown action '{action}'.")
        sig = inspect.signature(handler)
        accepts_var_kw = any(
            p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
        )
        if not accepts_var_kw:
            kwargs = {k: v for k, v in kwargs.items() if k in sig.parameters}
        return await handler(**kwargs)  # type: ignore[no-any-return]

    # --- shared helpers ----------------------------------------------------

    def _err(self, msg: str) -> ToolResult:
        return ToolResult(tool_name="desktop_control", success=False, output=None, error=msg)

    def _perm_hint(self, stderr_text: str) -> str:
        for keyword, hint in PERM_HINTS.items():
            if keyword in stderr_text:
                return hint
        return ""

    def _unsupported(self, action: str) -> ToolResult:
        return self._err(f"'{action}' is not supported on {self.platform_label} yet.")

    # --- apps --------------------------------------------------------------

    @abstractmethod
    async def list_installed_apps(self) -> ToolResult: ...

    @abstractmethod
    async def list_running_apps(self) -> ToolResult: ...

    @abstractmethod
    async def open_app(self, app_name: str | None = None) -> ToolResult: ...

    @abstractmethod
    async def quit_app(self, app_name: str | None = None) -> ToolResult: ...

    @abstractmethod
    async def focus_app(self, app_name: str | None = None) -> ToolResult: ...

    # --- windows -----------------------------------------------------------

    @abstractmethod
    async def list_windows(self, app_name: str | None = None) -> ToolResult: ...

    @abstractmethod
    async def focus_window(
        self, app_name: str | None = None, window_title: str | None = None
    ) -> ToolResult: ...

    @abstractmethod
    async def move_window(
        self, app_name: str | None = None, x: int | None = None, y: int | None = None
    ) -> ToolResult: ...

    @abstractmethod
    async def center_window(self, app_name: str | None = None) -> ToolResult: ...

    @abstractmethod
    async def resize_window(
        self, app_name: str | None = None, width: int | None = None, height: int | None = None
    ) -> ToolResult: ...

    @abstractmethod
    async def minimize_window(self, app_name: str | None = None) -> ToolResult: ...

    @abstractmethod
    async def maximize_window(self, app_name: str | None = None) -> ToolResult: ...

    @abstractmethod
    async def close_window(self, app_name: str | None = None) -> ToolResult: ...

    # --- input -------------------------------------------------------------

    @abstractmethod
    async def send_keystroke(
        self,
        app_name: str | None = None,
        key: str | None = None,
        modifiers: list[str] | None = None,
    ) -> ToolResult: ...

    @abstractmethod
    async def mouse_click(
        self, x: int | None = None, y: int | None = None, button: str = "left"
    ) -> ToolResult: ...

    @abstractmethod
    async def type_text(
        self, text: str | None = None, app_name: str | None = None
    ) -> ToolResult: ...

    # --- screen / clipboard ------------------------------------------------

    @abstractmethod
    async def screenshot(self, output_path: str | None = None) -> ToolResult: ...

    @abstractmethod
    async def get_clipboard(self) -> ToolResult: ...

    @abstractmethod
    async def set_clipboard(self, content: str | None = None) -> ToolResult: ...

    # --- escape hatch ------------------------------------------------------

    @abstractmethod
    async def run_script(self, script: str | None = None) -> ToolResult: ...
