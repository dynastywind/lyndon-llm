"""
Permission Gate — enforces read/write/exec access per active mode.

Mode permission matrix:
  Chat   → READ only
  Cowork → READ + WRITE + EXEC (gated by user approval)
  Code   → READ + WRITE + EXEC on repo (gated by user approval)
"""

from __future__ import annotations

from collections.abc import Callable
from enum import StrEnum
from functools import wraps
from typing import Any


class Permission(StrEnum):
    READ = "read"
    WRITE = "write"
    EXEC = "exec"


class Mode(StrEnum):
    CHAT = "chat"
    COWORK = "cowork"
    CODE = "code"


# Permissions allowed per mode (no approval needed)
MODE_PERMISSIONS: dict[Mode, set[Permission]] = {
    Mode.CHAT: {Permission.READ},
    Mode.COWORK: {Permission.READ, Permission.WRITE, Permission.EXEC},
    Mode.CODE: {Permission.READ, Permission.WRITE, Permission.EXEC},
}

# Permissions that require explicit user approval before execution
APPROVAL_REQUIRED: dict[Mode, set[Permission]] = {
    Mode.CHAT: set(),
    Mode.COWORK: {Permission.WRITE, Permission.EXEC},
    Mode.CODE: {Permission.WRITE, Permission.EXEC},
}


class PermissionDeniedError(Exception):
    """Raised when a tool is called with insufficient mode permissions."""

    def __init__(self, tool: str, permission: Permission, mode: Mode):
        self.tool = tool
        self.permission = permission
        self.mode = mode
        super().__init__(
            f"Tool '{tool}' requires {permission.value!r} permission, "
            f"which is not available in {mode.value!r} mode."
        )


class PermissionGate:
    def __init__(self, mode: Mode) -> None:
        self._mode = mode

    @property
    def mode(self) -> Mode:
        return self._mode

    def check(self, permission: Permission, tool_name: str = "unknown") -> None:
        """Raise PermissionDeniedError if the permission is not allowed in current mode."""
        if permission not in MODE_PERMISSIONS[self._mode]:
            raise PermissionDeniedError(tool_name, permission, self._mode)

    def requires_approval(self, permission: Permission) -> bool:
        """Return True if this permission needs user approval before execution."""
        return permission in APPROVAL_REQUIRED[self._mode]

    def allowed(self, permission: Permission) -> bool:
        return permission in MODE_PERMISSIONS[self._mode]


def require_permission(permission: Permission) -> Callable:
    """
    Decorator for tool methods. Reads the gate from the first argument (self)
    which must expose a `.gate: PermissionGate` attribute.

    Usage:
        class MyTool(BaseTool):
            @require_permission(Permission.WRITE)
            async def run(self, ...): ...
    """

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        async def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
            gate: PermissionGate = getattr(self, "gate", None)
            if gate is None:
                raise RuntimeError(
                    f"Tool {type(self).__name__} must expose a `.gate` attribute "
                    "to use @require_permission."
                )
            gate.check(permission, tool_name=type(self).__name__)
            return await fn(self, *args, **kwargs)

        return wrapper

    return decorator
