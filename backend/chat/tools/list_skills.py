"""List Skills tool — returns metadata for all skills installed by the current user."""

from __future__ import annotations

import json
from typing import Any

from core.permissions.gate import Permission, require_permission
from core.tools.base import BaseTool, ToolResult


class ListSkillsTool(BaseTool):
    name = "list_skills"
    description = (
        "List all skills installed by the user, including each skill's name, "
        "description, version, enabled status, and the tools it provides."
    )
    permission = Permission.READ

    @require_permission(Permission.READ)
    async def run(self, include_disabled: bool = False) -> ToolResult:  # type: ignore[override]
        if not self.user_id:
            return ToolResult(
                tool_name=self.name,
                success=False,
                output=None,
                error=(
                    "No authenticated user in this session — cannot list skills. "
                    "Please log in to view your installed skills."
                ),
            )

        try:
            from skills.manager import skill_manager

            skills = skill_manager.list_skills_for_user(self.user_id)

            if not include_disabled:
                skills = [s for s in skills if s["enabled"]]

            if not skills:
                msg = (
                    "No skills installed."
                    if include_disabled
                    else "No enabled skills installed. You can install skills from the Skills panel."
                )
                return ToolResult(tool_name=self.name, success=True, output=msg)

            output = [
                {
                    "name": s["name"],
                    "description": s["description"],
                    "version": s["version"],
                    "enabled": s["enabled"],
                    "installed_at": s["installed_at"],
                    "tools": [t["tool_name"] for t in s["tools"]],
                }
                for s in skills
            ]
            return ToolResult(
                tool_name=self.name,
                success=True,
                output=json.dumps(output, indent=2, ensure_ascii=False),
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
                    "include_disabled": {
                        "type": "boolean",
                        "description": "If true, also return disabled skills. Defaults to false.",
                        "default": False,
                    },
                },
                "required": [],
            },
        }
