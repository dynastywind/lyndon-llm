"""
RunCodeTool — execute user code snippets in a secure sandbox.

Registered for Chat mode.  The LLM calls this automatically when the user
asks to run, test, or verify a piece of code.  Execution is fully sandboxed
(Docker: no network, read-only filesystem, memory + CPU caps) so it is safe
to classify as READ permission.
"""
from __future__ import annotations

import difflib
from typing import Any

from core.permissions.gate import Permission
from core.tools.base import BaseTool, ToolResult
from core.permissions.gate import require_permission
from config.settings import settings


class RunCodeTool(BaseTool):
    name = "run_code"
    description = (
        "Execute a code snippet in a secure, isolated sandbox and return its output. "
        "Use this when the user asks to run, test, execute, or verify code in any language."
    )
    permission = Permission.READ   # execution is fully sandboxed

    @require_permission(Permission.READ)
    async def run(self, language: str, code: str) -> ToolResult:  # type: ignore[override]
        from sandbox.runner import run_code, LANGUAGES

        # Fuzzy-match the language key so "Python" → "python", "C++" → "cpp", etc.
        lang_key = language.lower().strip()
        _ALIASES = {
            "c++": "cpp", "c#": "csharp", "js": "javascript",
            "ts": "typescript", "node": "javascript", "nodejs": "javascript",
            "py": "python", "rb": "ruby", "rs": "rust",
            "hs": "haskell", "ml": "ocaml", "erl": "erlang",
            "ex": "elixir", "exs": "elixir", "kt": "kotlin",
            "objc": "objc", "objectivec": "objc", "objective-c": "objc",
            "cs": "csharp", "sh": "bash", "shell": "bash",
        }
        lang_key = _ALIASES.get(lang_key, lang_key)

        if lang_key not in LANGUAGES:
            matches = difflib.get_close_matches(lang_key, LANGUAGES.keys(), n=3)
            hint = f"  Did you mean: {', '.join(matches)}?" if matches else ""
            return ToolResult(
                tool_name=self.name, success=False, output=None,
                error=f"Unknown language {language!r}.{hint}  "
                      f"Supported: {', '.join(sorted(LANGUAGES))}",
            )

        timeout = min(60, settings.sandbox_timeout)
        result = await run_code(lang_key, code, timeout=timeout)

        output = _format_result(result, LANGUAGES[lang_key].label, code)
        success = result["exit_code"] == 0 and not result["timed_out"]

        return ToolResult(
            tool_name=self.name,
            success=success,
            output=output,
            error=None if success else (result["stderr"] or "Non-zero exit code"),
        )

    def schema(self) -> dict[str, Any]:
        from sandbox.runner import LANGUAGES
        lang_ids = sorted(LANGUAGES.keys())
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "language": {
                        "type": "string",
                        "description": (
                            "The programming language to execute. "
                            f"Supported values: {', '.join(lang_ids)}."
                        ),
                        "enum": lang_ids,
                    },
                    "code": {
                        "type": "string",
                        "description": (
                            "The complete, self-contained code to execute. "
                            "For Java, use 'public class Main' as the class name. "
                            "For C#, write a top-level program or include a Main method."
                        ),
                    },
                },
                "required": ["language", "code"],
            },
        }


# ---------------------------------------------------------------------------
# Output formatter
# ---------------------------------------------------------------------------

def _format_result(r: dict, label: str, code: str = "") -> str:
    """Format the sandbox result dict into a clean string for the LLM."""
    parts: list[str] = []

    if code.strip():
        parts.append(f"{label} code:\n{code.strip()}")

    stdout = (r.get("stdout") or "").rstrip()
    stderr = (r.get("stderr") or "").rstrip()

    if stdout:
        parts.append(f"Output:\n{stdout}")
    elif not stderr:
        parts.append("Output:\n(no output)")

    if stderr:
        parts.append(f"Errors:\n{stderr}")

    if r["timed_out"]:
        parts.append("⚠ Execution timed out.")

    return "\n\n".join(parts)
