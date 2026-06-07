"""
Cross-platform desktop-control drivers.

The ``OSControlTool`` (see ``cowork/tools/os_control.py``) exposes a single
platform-neutral action surface to the LLM and dispatches each action to the
driver for the host OS — ``MacDriver`` today, ``WindowsDriver`` later.
"""

from __future__ import annotations

from core.tools.os_control.base import ACTION_RISK, OS_CONTROL_ACTIONS, OSDriver

__all__ = ["ACTION_RISK", "OS_CONTROL_ACTIONS", "OSDriver"]
