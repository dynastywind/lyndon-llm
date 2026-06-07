"""
Tests for the cross-platform desktop-control tool.

Two tiers:
  * Platform-independent — wiring and pure logic (registration, risk tiers,
    schema, driver selection, the approval-gate decision). These run on any OS.
  * Platform-dependent — live driver actions that shell out to the host OS.
    Guarded with ``skipif`` so they execute only on macOS (the only driver
    implemented today); the Windows driver is a stub, Linux is unsupported.
"""

from __future__ import annotations

import os
import platform
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from chat.engine import _should_request_approval  # noqa: E402
from core.permissions.gate import Mode, PermissionGate  # noqa: E402
from core.tools.os_control.base import ACTION_RISK, OS_CONTROL_ACTIONS  # noqa: E402
from core.tools.os_control.mac import MacDriver  # noqa: E402
from core.tools.os_control.windows import WindowsDriver  # noqa: E402
from core.tools.registry import ToolRegistry  # noqa: E402
from core.tools.risk import RiskTier  # noqa: E402
from cowork.tools.mac_control import MacControlTool  # noqa: E402
from cowork.tools.os_control import OSControlTool  # noqa: E402

IS_MAC = platform.system() == "Darwin"
mac_only = pytest.mark.skipif(not IS_MAC, reason="MacDriver requires macOS (osascript/screencapture)")


def _gate() -> PermissionGate:
    return PermissionGate(Mode.COWORK)


def _tool() -> OSControlTool:
    return OSControlTool(_gate())


# ── Platform-independent: risk tiers ──────────────────────────────────────────


def test_risk_tier_ordering():
    assert RiskTier.SAFE < RiskTier.SENSITIVE < RiskTier.DANGEROUS


def test_every_action_has_a_risk_tier():
    # Each advertised action must be classified so the gate never guesses.
    for action in OS_CONTROL_ACTIONS:
        assert action in ACTION_RISK, f"{action} missing from ACTION_RISK"


@pytest.mark.parametrize(
    ("action", "tier"),
    [
        ("list_installed_apps", RiskTier.SAFE),
        ("list_running_apps", RiskTier.SAFE),
        ("list_windows", RiskTier.SAFE),
        ("get_clipboard", RiskTier.SAFE),
        ("screenshot", RiskTier.SAFE),
        ("open_app", RiskTier.SENSITIVE),
        ("focus_window", RiskTier.SENSITIVE),
        ("move_window", RiskTier.SENSITIVE),
        ("center_window", RiskTier.SENSITIVE),
        ("set_clipboard", RiskTier.SENSITIVE),
        ("create_note", RiskTier.SENSITIVE),
        ("quit_app", RiskTier.DANGEROUS),
        ("close_window", RiskTier.DANGEROUS),
        ("send_keystroke", RiskTier.DANGEROUS),
        ("mouse_click", RiskTier.DANGEROUS),
        ("type_text", RiskTier.DANGEROUS),
        ("run_script", RiskTier.DANGEROUS),
    ],
)
def test_risk_for_known_actions(action, tier):
    assert _tool().risk_for({"action": action}) == tier


def test_risk_for_unknown_action_defaults_dangerous():
    assert _tool().risk_for({"action": "no_such_action"}) == RiskTier.DANGEROUS
    assert _tool().risk_for({}) == RiskTier.DANGEROUS


# ── Platform-independent: approval-gate decision matrix ───────────────────────


@pytest.mark.parametrize(
    ("ask_mode", "risk", "expected"),
    [
        # "Ask first": prompt on SENSITIVE and above
        (True, RiskTier.SAFE, False),
        (True, RiskTier.SENSITIVE, True),
        (True, RiskTier.DANGEROUS, True),
        # "Act": prompt only on DANGEROUS
        (False, RiskTier.SAFE, False),
        (False, RiskTier.SENSITIVE, False),
        (False, RiskTier.DANGEROUS, True),
        # Non-risk tool (risk is None): coarse session boolean
        (True, None, True),
        (False, None, False),
    ],
)
def test_approval_gate_matrix(ask_mode, risk, expected):
    assert _should_request_approval(ask_mode, risk) is expected


# ── Platform-independent: schema ──────────────────────────────────────────────


def test_schema_exposes_all_actions():
    schema = _tool().schema()
    enum = schema["parameters"]["properties"]["action"]["enum"]
    assert set(enum) == set(OS_CONTROL_ACTIONS)
    assert schema["parameters"]["required"] == ["action"]
    assert schema["name"] == "desktop_control"


def test_legacy_alias_schema_keeps_old_actions():
    schema = MacControlTool(_gate()).schema()
    enum = schema["parameters"]["properties"]["action"]["enum"]
    assert "run_applescript" in enum and "list_apps" in enum
    assert schema["name"] == "mac_control"


@pytest.mark.parametrize(
    ("action", "tier"),
    [
        ("list_apps", RiskTier.SAFE),
        ("take_screenshot", RiskTier.SAFE),
        ("focus_app", RiskTier.SENSITIVE),
        ("run_applescript", RiskTier.DANGEROUS),
        ("send_keystroke", RiskTier.DANGEROUS),
    ],
)
def test_legacy_alias_risk_for(action, tier):
    assert MacControlTool(_gate()).risk_for({"action": action}) == tier


# ── Platform-independent: registration ────────────────────────────────────────


def test_registration_in_cowork_and_code():
    reg = ToolRegistry()
    for mode in (Mode.COWORK, Mode.CODE):
        reg.register(mode, OSControlTool)
        reg.register(mode, MacControlTool)
        names = reg.list_tool_names(mode)
        assert "desktop_control" in names
        assert "mac_control" in names


# ── Platform-independent: driver selection ────────────────────────────────────


def test_driver_selection_darwin(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    assert isinstance(_tool()._driver(), MacDriver)


def test_driver_selection_windows(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    assert isinstance(_tool()._driver(), WindowsDriver)


def test_driver_selection_unsupported(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    assert _tool()._driver() is None


async def test_run_on_unsupported_platform_errors(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    res = await _tool().run(action="list_running_apps")
    assert res.success is False
    assert "not supported" in (res.error or "").lower()


# ── Platform-independent: Windows stub returns a clear error ──────────────────


async def test_windows_driver_actions_are_stubbed():
    driver = WindowsDriver()
    for action in ("list_running_apps", "screenshot", "run_script"):
        res = await driver.dispatch(action)
        assert res.success is False
        assert "Windows" in (res.error or "")


async def test_driver_rejects_unknown_action():
    res = await MacDriver().dispatch("totally_unknown")
    assert res.success is False
    assert "Unknown action" in (res.error or "")


async def test_dispatch_drops_unexpected_kwargs():
    # Models over-supply args from the shared schema (e.g. x/y on open_app).
    # Dispatch must drop extras instead of raising TypeError. Use the Windows
    # stub so no real OS action runs — we only assert it doesn't blow up.
    res = await WindowsDriver().dispatch("open_app", app_name="Safari", x=10, y=20, junk=1)
    assert res.success is False  # stub: unsupported, but reached cleanly
    assert "Windows" in (res.error or "")


# ── Platform-dependent: live macOS driver actions ─────────────────────────────


@mac_only
async def test_mac_list_running_apps_live():
    res = await _tool().run(action="list_running_apps")
    assert res.success is True
    assert res.output  # at least one process is always running


@mac_only
async def test_mac_get_clipboard_live():
    res = await _tool().run(action="get_clipboard")
    assert res.success is True  # may be empty, but the call must succeed


@mac_only
async def test_mac_screenshot_live(tmp_path):
    out = tmp_path / "shot.png"
    res = await _tool().run(action="screenshot", output_path=str(out))
    assert res.success is True
    assert out.exists() and out.stat().st_size > 0


@mac_only
async def test_mac_legacy_alias_list_apps_live():
    res = await MacControlTool(_gate()).run(action="list_apps")
    assert res.success is True
    assert res.output


@mac_only
async def test_mac_create_note_live():
    title = "lyndonLLM pytest note"
    try:
        res = await _tool().run(action="create_note", title=title, body="created by pytest")
        assert res.success is True
        # Confirm the note actually exists in Notes.
        check = await MacDriver().run_script(
            f'tell application "Notes" to count (notes whose name is "{title}")'
        )
        assert check.success is True
        assert int((check.output or "0").strip()) >= 1
    finally:
        # Clean up regardless of assertion outcome.
        await MacDriver().run_script(
            'tell application "Notes"\n'
            f'  repeat with n in (get notes whose name is "{title}")\n'
            "    delete n\n"
            "  end repeat\n"
            "end tell"
        )
