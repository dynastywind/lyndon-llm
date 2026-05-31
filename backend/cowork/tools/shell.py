"""Shell execution tool — Cowork/Code modes only, requires EXEC permission."""

from __future__ import annotations

import asyncio
from typing import Any

from config.settings import settings
from core.permissions.gate import Permission, require_permission
from core.tools.base import BaseTool, ToolResult


class ShellTool(BaseTool):
    name = "shell"
    description = "Run a shell command on the local machine."
    permission = Permission.EXEC

    @require_permission(Permission.EXEC)
    async def run(
        self, command: str, cwd: str | None = None, timeout: int | None = None
    ) -> ToolResult:
        t = timeout or settings.cowork_shell_timeout
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=cwd,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=t)
            output = stdout.decode(errors="replace")
            success = proc.returncode == 0
            return ToolResult(
                tool_name=self.name,
                success=success,
                output=output,
                error=None if success else f"Exit code {proc.returncode}",
            )
        except TimeoutError:
            return ToolResult(
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Command timed out after {t}s",
            )
        except Exception as e:
            return ToolResult(tool_name=self.name, success=False, output=None, error=str(e))

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to execute."},
                    "cwd": {"type": "string", "description": "Working directory."},
                    "timeout": {"type": "integer", "description": "Timeout in seconds."},
                },
                "required": ["command"],
            },
        }
