"""REST endpoints for skill management."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.auth_deps import get_current_user
from db.base import AsyncSessionLocal
from db.models.user import User
from db.repos.skill import SkillRepo
from skills.manager import skill_manager
from skills.parser import parse_skill_folder, parse_skill_zip

logger = logging.getLogger(__name__)

router = APIRouter()


# ── response schemas ──────────────────────────────────────────────────────────


def _tool_out(tool) -> dict[str, Any]:
    try:
        params = json.loads(tool.parameters_schema_json or "{}")
    except json.JSONDecodeError:
        params = {}
    return {
        "id": tool.id,
        "tool_name": tool.tool_name,
        "description": tool.description,
        "language": tool.language,
        "parameters_schema": params,
    }


def _skill_out(skill) -> dict[str, Any]:
    return {
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "version": skill.version,
        "enabled": skill.enabled,
        "created_at": skill.created_at.isoformat(),
        "tools": [_tool_out(t) for t in skill.tools],
    }


# ── routes ────────────────────────────────────────────────────────────────────


@router.get("")
async def list_skills(user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        repo = SkillRepo(db)
        skills = await repo.list_skills(user.id)
    return [_skill_out(s) for s in skills]


@router.post("/upload")
async def upload_skill(
    file: UploadFile | None = File(default=None),
    files: list[UploadFile] = File(default=[]),
    user: User = Depends(get_current_user),
):
    """Accept either a single zip file or multiple files (folder upload)."""
    if file is not None:
        # Single zip upload
        if not (file.filename or "").lower().endswith(".zip"):
            raise HTTPException(status_code=400, detail="Expected a .zip file")
        zip_bytes = await file.read()
        try:
            parsed = parse_skill_zip(zip_bytes)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    elif files:
        # Folder upload — browser sends files with relative paths in filename
        file_map: dict[str, bytes] = {}
        for f in files:
            name = (f.filename or "").lstrip("/")
            file_map[name] = await f.read()
        try:
            parsed = parse_skill_folder(file_map)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    else:
        raise HTTPException(status_code=400, detail="No file or files provided")

    tools_data = [
        {
            "tool_name": t.tool_name,
            "description": t.description,
            "language": t.language,
            "script_content": t.script_content,
            "parameters_schema": t.parameters_schema,
        }
        for t in parsed.tools
    ]

    async with AsyncSessionLocal() as db:
        repo = SkillRepo(db)
        skill = await repo.create_skill(
            user_id=user.id,
            name=parsed.name,
            description=parsed.description,
            version=parsed.version,
            tools=tools_data,
        )

    await skill_manager.reload_for_user(user.id)
    return _skill_out(skill)


class ToggleBody(BaseModel):
    enabled: bool


@router.patch("/{skill_id}")
async def toggle_skill(
    skill_id: str,
    body: ToggleBody,
    user: User = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        repo = SkillRepo(db)
        skill = await repo.get_skill(skill_id)
        if skill is None or skill.user_id != user.id:
            raise HTTPException(status_code=404, detail="Skill not found")
        skill = await repo.set_enabled(skill_id, body.enabled)

    await skill_manager.reload_for_user(user.id)
    return _skill_out(skill)


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: str,
    user: User = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        repo = SkillRepo(db)
        skill = await repo.get_skill(skill_id)
        if skill is None or skill.user_id != user.id:
            raise HTTPException(status_code=404, detail="Skill not found")
        await repo.delete_skill(skill_id)

    await skill_manager.reload_for_user(user.id)
    return JSONResponse(status_code=204, content=None)
