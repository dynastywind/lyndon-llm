"""
Tests for core/tools/working_dir.py — per-thread work directory resolution.

Covers:
  - normalize_working_directory  (expand ~, validate existence)
  - apply_working_directory      (default shell cwd / resolve file paths)
"""

from __future__ import annotations

import os
from pathlib import Path
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from core.tools.working_dir import (  # noqa: E402
    apply_working_directory,
    normalize_working_directory,
)

# ── normalize_working_directory ───────────────────────────────────────────────


def test_normalize_none_and_blank():
    assert normalize_working_directory(None) is None
    assert normalize_working_directory("") is None
    assert normalize_working_directory("   ") is None


def test_normalize_existing_dir(tmp_path):
    assert normalize_working_directory(str(tmp_path)) == str(tmp_path.resolve())


def test_normalize_strips_whitespace(tmp_path):
    assert normalize_working_directory(f"  {tmp_path}  ") == str(tmp_path.resolve())


def test_normalize_expands_home(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    sub = tmp_path / "work"
    sub.mkdir()
    assert normalize_working_directory("~/work") == str(sub.resolve())


def test_normalize_missing_dir_returns_none(tmp_path):
    assert normalize_working_directory(str(tmp_path / "does-not-exist")) is None


def test_normalize_file_is_not_a_dir(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("hi")
    assert normalize_working_directory(str(f)) is None


# ── apply_working_directory ───────────────────────────────────────────────────


def test_apply_no_working_dir_is_noop():
    args = {"command": "ls"}
    assert apply_working_directory("shell", args, None) is args


def test_apply_shell_defaults_cwd():
    out = apply_working_directory("shell", {"command": "ls"}, "/work")
    assert out == {"command": "ls", "cwd": "/work"}


def test_apply_shell_keeps_model_cwd():
    args = {"command": "ls", "cwd": "/explicit"}
    out = apply_working_directory("shell", args, "/work")
    assert out["cwd"] == "/explicit"


def test_apply_file_resolves_relative_path():
    out = apply_working_directory("file_write", {"path": "sub/a.py", "content": "x"}, "/work")
    assert out["path"] == str(Path("/work") / "sub/a.py")
    assert out["content"] == "x"


def test_apply_file_keeps_absolute_path():
    args = {"path": "/etc/hosts"}
    out = apply_working_directory("file_read", args, "/work")
    assert out is args


def test_apply_file_expands_home(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    out = apply_working_directory("file_read", {"path": "~/notes.txt"}, "/work")
    assert out["path"] == str(tmp_path / "notes.txt")


def test_apply_unknown_tool_is_noop():
    args = {"query": "weather"}
    assert apply_working_directory("web_search", args, "/work") is args


def test_apply_does_not_mutate_input():
    args = {"command": "ls"}
    apply_working_directory("shell", args, "/work")
    assert args == {"command": "ls"}
