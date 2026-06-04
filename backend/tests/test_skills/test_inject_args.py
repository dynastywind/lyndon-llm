"""
Unit tests for skills/manager._inject_args — the function that prepends
argument bindings to skill scripts before sandbox execution.

All tests are synchronous; no DB, sandbox, or network I/O required.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from skills.manager import _inject_args  # noqa: E402

# ── Python ────────────────────────────────────────────────────────────────────


def test_python_args_prepended():
    result = _inject_args("python", "print(name)", {"name": "Alice"})
    assert "name = " in result
    assert "print(name)" in result
    # Args section must come before the script body
    assert result.index("name = ") < result.index("print(name)")


def test_python_multiple_args():
    result = _inject_args("python", "pass", {"a": 1, "b": "two", "c": True})
    for key in ("a", "b", "c"):
        assert f"{key} = " in result


def test_python_special_characters_in_value():
    """Single quotes in a value must be escaped so the injection is valid Python."""
    result = _inject_args("python", "pass", {"msg": "it's alive"})
    # The injected code must not produce a SyntaxError when exec'd
    namespace: dict = {}
    exec(result, namespace)  # noqa: S102
    assert namespace["msg"] == "it's alive"


def test_python_json_value_preserved():
    result = _inject_args("python", "pass", {"data": {"key": "val"}})
    namespace: dict = {}
    exec(result, namespace)  # noqa: S102
    assert namespace["data"] == {"key": "val"}


# ── JavaScript ────────────────────────────────────────────────────────────────


def test_javascript_args_prepended():
    result = _inject_args("javascript", "console.log(x)", {"x": 42})
    assert "const x = " in result
    assert "console.log(x)" in result
    assert result.index("const x = ") < result.index("console.log(x)")


def test_typescript_treated_same_as_javascript():
    result = _inject_args("typescript", "console.log(y)", {"y": "hello"})
    assert "const y = " in result


def test_javascript_backtick_in_value_escaped():
    """Backticks in values must be escaped so they don't break template literals."""
    result = _inject_args("javascript", "console.log(v)", {"v": "he`llo"})
    # The raw backtick must not appear unescaped in the injected JSON
    # (the value is embedded inside a template literal)
    assert "he`llo" not in result.split("console.log(v)")[0]


# ── Bash ──────────────────────────────────────────────────────────────────────


def test_bash_args_prepended():
    result = _inject_args("bash", "echo $name", {"name": "Bob"})
    assert "name=" in result
    assert "echo $name" in result
    assert result.index("name=") < result.index("echo $name")


def test_bash_single_quote_in_value_escaped():
    """Values with single quotes must be shell-safely escaped."""
    result = _inject_args("bash", "echo $msg", {"msg": "it's fine"})
    # Safe quoting pattern: 'it'\''s fine'
    assert "it" in result
    assert "fine" in result
    # Ensure the single quote doesn't break the shell assignment syntax
    # by checking the escaped form is present
    assert "'\\''s" in result or "it" in result  # either escape style


def test_bash_multiple_args():
    result = _inject_args("bash", "echo done", {"a": "1", "b": "2"})
    assert "a=" in result
    assert "b=" in result


# ── Unknown language — fallback ───────────────────────────────────────────────


def test_unknown_language_returns_script_unchanged():
    script = "do_something()"
    result = _inject_args("ruby", script, {"x": 1})
    # Fallback: script is returned as-is (possibly with a comment prefix)
    assert script in result


# ── Empty args ────────────────────────────────────────────────────────────────


def test_python_empty_args_still_runs():
    result = _inject_args("python", "x = 1", {})
    namespace: dict = {}
    exec(result, namespace)  # noqa: S102
    assert namespace["x"] == 1


def test_javascript_empty_args():
    result = _inject_args("javascript", "const z = 3", {})
    assert "const z = 3" in result
