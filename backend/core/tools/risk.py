"""
Per-call risk tiers for the tool-approval gate.

A tool may classify each call into a risk tier so the engine can decide whether
to pause for user approval based on both the tier and the session's acting mode
("ask first" vs "act").  Tools that do not implement ``risk_for`` fall back to
the coarse session-wide approval boolean (see ``chat/engine.py``).
"""

from __future__ import annotations

from enum import IntEnum


class RiskTier(IntEnum):
    """How dangerous a single tool call is. Higher = more likely to need approval."""

    SAFE = 0  # read-only: list_*, get_clipboard, screenshot
    SENSITIVE = 1  # reversible state change: focus/move/resize/min/max window, open_app, set_clipboard
    DANGEROUS = 2  # arbitrary/irreversible: run_script, send_keystroke, mouse_click, type_text, quit/close
