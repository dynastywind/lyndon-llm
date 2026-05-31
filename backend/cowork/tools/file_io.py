"""File I/O tools — read (Chat-safe) and write (Cowork/Code only)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from core.permissions.gate import Permission, require_permission
from core.tools.base import BaseTool, ToolResult


class FileReadTool(BaseTool):
    name = "file_read"
    description = "Read the contents of a local file."
    permission = Permission.READ

    @require_permission(Permission.READ)
    async def run(self, path: str, encoding: str = "utf-8") -> ToolResult:
        try:
            content = Path(path).read_text(encoding=encoding, errors="replace")
            return ToolResult(tool_name=self.name, success=True, output=content)
        except Exception as e:
            return ToolResult(tool_name=self.name, success=False, output=None, error=str(e))

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute or relative file path."},
                },
                "required": ["path"],
            },
        }


class FileWriteTool(BaseTool):
    name = "file_write"
    description = "Write or overwrite a local file with the given content."
    permission = Permission.WRITE

    @require_permission(Permission.WRITE)
    async def run(self, path: str, content: str, encoding: str = "utf-8") -> ToolResult:
        try:
            p = Path(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding=encoding)
            return ToolResult(tool_name=self.name, success=True, output=f"Written: {path}")
        except Exception as e:
            return ToolResult(tool_name=self.name, success=False, output=None, error=str(e))

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        }
