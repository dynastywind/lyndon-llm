"""CRUD for user-installed skills."""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models.skill import Skill, SkillTool


class SkillRepo:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list_skills(self, user_id: str) -> list[Skill]:
        result = await self._db.execute(
            select(Skill)
            .options(selectinload(Skill.tools))
            .where(Skill.user_id == user_id)
            .order_by(Skill.created_at)
        )
        return list(result.scalars().all())

    async def get_skill_by_name(self, user_id: str, name: str) -> Skill | None:
        result = await self._db.execute(
            select(Skill)
            .options(selectinload(Skill.tools))
            .where(Skill.user_id == user_id, Skill.name == name)
        )
        return result.scalar_one_or_none()

    async def get_skill(self, skill_id: str) -> Skill | None:
        result = await self._db.execute(
            select(Skill).options(selectinload(Skill.tools)).where(Skill.id == skill_id)
        )
        return result.scalar_one_or_none()

    async def create_skill(
        self,
        *,
        user_id: str,
        name: str,
        description: str,
        version: str,
        tools: list[dict],
    ) -> Skill:
        skill = Skill(user_id=user_id, name=name, description=description, version=version)
        self._db.add(skill)
        await self._db.flush()  # get skill.id

        for t in tools:
            tool_row = SkillTool(
                skill_id=skill.id,
                tool_name=t["tool_name"],
                description=t["description"],
                language=t["language"],
                script_content=t["script_content"],
                parameters_schema_json=json.dumps(t["parameters_schema"]),
            )
            self._db.add(tool_row)

        await self._db.commit()
        await self._db.refresh(skill)
        result = await self._db.execute(
            select(Skill).options(selectinload(Skill.tools)).where(Skill.id == skill.id)
        )
        return result.scalar_one()

    async def set_enabled(self, skill_id: str, enabled: bool) -> Skill | None:
        skill = await self.get_skill(skill_id)
        if skill is None:
            return None
        skill.enabled = enabled
        await self._db.commit()
        await self._db.refresh(skill)
        return await self.get_skill(skill_id)

    async def delete_skill(self, skill_id: str) -> bool:
        skill = await self.get_skill(skill_id)
        if skill is None:
            return False
        await self._db.delete(skill)
        await self._db.commit()
        return True
