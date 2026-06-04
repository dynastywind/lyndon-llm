"""Runtime registry for skill tools — mirrors the MCP tool manager."""

from __future__ import annotations

import json
import logging
from typing import Any

from core.permissions.gate import Mode, Permission
from core.tools.base import BaseTool, ToolResult
from core.tools.registry import tool_registry
from db.base import AsyncSessionLocal
from db.models.skill import Skill, SkillTool
from db.repos.skill import SkillRepo

logger = logging.getLogger(__name__)

_SKILL_MODES = (Mode.CHAT, Mode.COWORK)


def _qualified_name(skill_id: str, tool_name: str) -> str:
    return f"skill__{skill_id}__{tool_name}"


def _inject_args(language: str, script: str, kwargs: dict) -> str:
    """Prepend argument bindings to the script so the LLM args are available as variables."""
    args_json = json.dumps(kwargs, ensure_ascii=False)
    # Escape for safe embedding in different string literals
    args_escaped = args_json.replace("\\", "\\\\").replace("'", "\\'")

    if language == "python":
        lines = ["import json as _sa_json_"]
        lines.append(f"_sa_args_ = _sa_json_.loads('{args_escaped}')")
        for k in kwargs:
            lines.append(f"{k} = _sa_args_.get({k!r})")
        lines.append("del _sa_json_, _sa_args_")
        lines.append("")
        return "\n".join(lines) + script

    if language in ("javascript", "typescript"):
        safe_json = args_json.replace("`", "\\`").replace("${", "\\${")
        lines = [f"const _skillArgs_ = JSON.parse(`{safe_json}`);"]
        for k in kwargs:
            lines.append(f"const {k} = _skillArgs_[{json.dumps(k)}];")
        lines.append("")
        return "\n".join(lines) + script

    if language == "bash":
        lines = []
        for k, v in kwargs.items():
            # Escape value for single-quoted shell string
            v_str = str(v).replace("'", "'\\''")
            lines.append(f"{k}='{v_str}'")
        lines.append("")
        return "\n".join(lines) + script

    # Generic fallback: write _skill_args as shell-style comment; script must read _skill_args.json
    return script


class SkillManager:
    def __init__(self) -> None:
        self._tool_meta: dict[str, dict[str, Any]] = {}
        # skill_id → skill-level metadata (name, description, version, user_id, tools list)
        self._skill_catalog: dict[str, dict[str, Any]] = {}

    async def reload_all(self) -> None:
        """Load all enabled skills for all users from DB and register their tools."""
        self._clear_all()
        async with AsyncSessionLocal() as db:
            # Load every skill regardless of user — tools are keyed by skill_id
            from sqlalchemy import select
            from sqlalchemy.orm import selectinload

            result = await db.execute(
                select(Skill).options(selectinload(Skill.tools))
            )
            skills = list(result.scalars().all())
            for skill in skills:
                if skill.enabled:
                    self._register_skill(skill)

    async def reload_for_user(self, user_id: str) -> None:
        """Re-register all enabled skills for a specific user (after upload/toggle/delete)."""
        self._clear_user_tools(user_id)
        async with AsyncSessionLocal() as db:
            repo = SkillRepo(db)
            skills = await repo.list_skills(user_id)
            for skill in skills:
                if skill.enabled:
                    self._register_skill(skill)

    def _register_skill(self, skill: Skill) -> None:
        self._skill_catalog[skill.id] = {
            "skill_id": skill.id,
            "user_id": skill.user_id,
            "name": skill.name,
            "description": skill.description,
            "version": skill.version,
            "enabled": skill.enabled,
            "installed_at": skill.created_at.isoformat(),
            "tools": [
                {
                    "tool_name": t.tool_name,
                    "description": t.description,
                    "language": t.language,
                }
                for t in skill.tools
            ],
        }
        for tool in skill.tools:
            self._register_one_tool(skill, tool)

    def _register_one_tool(self, skill: Skill, tool: SkillTool) -> None:
        qname = _qualified_name(skill.id, tool.tool_name)
        try:
            params_schema = json.loads(tool.parameters_schema_json or "{}")
        except json.JSONDecodeError:
            params_schema = {}

        skill_id = skill.id
        skill_name = skill.name
        tool_name = tool.tool_name
        _desc = tool.description or f"Skill tool {tool_name} from {skill_name}"
        language = tool.language
        script_content = tool.script_content

        class _SkillDynamicTool(BaseTool):
            name = qname
            description = _desc
            permission = Permission.READ

            async def run(self, **kwargs: Any) -> ToolResult:
                from sandbox.runner import run_code

                full_code = _inject_args(language, script_content, kwargs)
                result = await run_code(language, full_code, timeout=30)

                if result.get("timed_out"):
                    return ToolResult(
                        tool_name=qname,
                        success=False,
                        output=None,
                        error="Skill script timed out after 30 seconds",
                    )

                output = result.get("stdout", "").strip()
                stderr = result.get("stderr", "").strip()
                exit_code = result.get("exit_code", 0)

                if exit_code != 0:
                    error_msg = stderr or f"Script exited with code {exit_code}"
                    return ToolResult(tool_name=qname, success=False, output=output or None, error=error_msg)

                return ToolResult(tool_name=qname, success=True, output=output or stderr or "(no output)")

            def schema(self) -> dict[str, Any]:
                params = (
                    params_schema
                    if params_schema.get("type") == "object"
                    else {"type": "object", "properties": params_schema or {}}
                )
                return {
                    "name": qname,
                    "description": _desc,
                    "parameters": params,
                }

        self._tool_meta[qname] = {"skill_id": skill_id, "user_id": skill.user_id, "tool_name": tool_name}
        for mode in _SKILL_MODES:
            tool_registry.register_skill(mode, _SkillDynamicTool)

    def _unregister_skill(self, skill_id: str) -> None:
        to_remove = [qname for qname, meta in self._tool_meta.items() if meta["skill_id"] == skill_id]
        for qname in to_remove:
            self._tool_meta.pop(qname, None)
            for mode in _SKILL_MODES:
                tool_registry.unregister_skill(mode, qname)
        self._skill_catalog.pop(skill_id, None)

    def _clear_user_tools(self, user_id: str) -> None:
        to_remove = [qname for qname, meta in self._tool_meta.items() if meta.get("user_id") == user_id]
        for qname in to_remove:
            self._tool_meta.pop(qname, None)
            for mode in _SKILL_MODES:
                tool_registry.unregister_skill(mode, qname)
        for skill_id in [sid for sid, meta in self._skill_catalog.items() if meta["user_id"] == user_id]:
            self._skill_catalog.pop(skill_id, None)

    def _clear_all(self) -> None:
        for mode in _SKILL_MODES:
            tool_registry.clear_skills(mode)
        self._tool_meta.clear()
        self._skill_catalog.clear()

    def list_skills_for_user(self, user_id: str) -> list[dict[str, Any]]:
        """Return cached skill metadata for a user (no DB call needed)."""
        return [meta for meta in self._skill_catalog.values() if meta["user_id"] == user_id]


skill_manager = SkillManager()
