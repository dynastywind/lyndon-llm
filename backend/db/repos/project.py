"""
CRUD operations for projects and their member sessions.
"""

from __future__ import annotations

from datetime import UTC, datetime
import json
import uuid

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.chat import ChatSession
from db.models.project import Project


class ProjectRepo:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Projects ────────────────────────────────────────────────────────────

    async def create(
        self,
        mode: str,
        name: str,
        user_id: str | None = None,
        instructions: str | None = None,
    ) -> Project:
        row = Project(
            id=str(uuid.uuid4()),
            user_id=user_id,
            mode=mode,
            name=name,
            instructions=instructions,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def get(self, project_id: str) -> Project | None:
        result = await self._db.execute(select(Project).where(Project.id == project_id))
        return result.scalar_one_or_none()

    async def list(
        self, mode: str = "chat", user_id: str | None = None
    ) -> list[Project]:
        filters = [Project.mode == mode]
        if user_id is not None:
            filters.append(Project.user_id == user_id)
        rows = list(
            (
                await self._db.execute(
                    select(Project).where(*filters).order_by(Project.updated_at.desc())
                )
            ).scalars()
        )
        return rows

    async def search(
        self, query: str, mode: str = "chat", user_id: str | None = None
    ) -> list[Project]:
        """Return projects whose name or instructions match *query* (LIKE)."""
        like_q = f"%{query}%"
        filters = [
            Project.mode == mode,
            or_(Project.name.ilike(like_q), Project.instructions.ilike(like_q)),
        ]
        if user_id is not None:
            filters.append(Project.user_id == user_id)
        rows = list(
            (
                await self._db.execute(
                    select(Project).where(*filters).order_by(Project.updated_at.desc())
                )
            ).scalars()
        )
        return rows

    async def update(
        self,
        project_id: str,
        name: str | None = None,
        instructions: str | None = None,
        folders: list[dict] | None = None,
    ) -> Project | None:
        row = await self.get(project_id)
        if row is None:
            return None
        values: dict = {"updated_at": datetime.now(UTC)}
        if name is not None:
            values["name"] = name.strip() or row.name
        if instructions is not None:
            values["instructions"] = instructions.strip() or None
        if folders is not None:
            values["folders_json"] = json.dumps(folders) if folders else None
        await self._db.execute(update(Project).where(Project.id == project_id).values(**values))
        await self._db.commit()
        return await self.get(project_id)

    async def touch(self, project_id: str) -> None:
        """Bump updated_at so the project floats to the top of the list."""
        await self._db.execute(
            update(Project).where(Project.id == project_id).values(updated_at=datetime.now(UTC))
        )
        await self._db.commit()

    async def delete(self, project_id: str) -> bool:
        """Delete a project, first returning its sessions to Recents (project_id → null)."""
        row = await self.get(project_id)
        if row is None:
            return False
        await self._db.execute(
            update(ChatSession)
            .where(ChatSession.project_id == project_id)
            .values(project_id=None)
        )
        await self._db.delete(row)
        await self._db.commit()
        return True

    # ── Member sessions ─────────────────────────────────────────────────────

    async def list_sessions(self, project_id: str) -> list[ChatSession]:
        rows = list(
            (
                await self._db.execute(
                    select(ChatSession)
                    .where(ChatSession.project_id == project_id)
                    .order_by(ChatSession.updated_at.desc())
                )
            ).scalars()
        )
        return rows

    async def count_sessions(self, project_ids: list[str]) -> dict[str, int]:
        """Return {project_id: session_count} for the given projects."""
        if not project_ids:
            return {}
        rows = (
            await self._db.execute(
                select(ChatSession.project_id, func.count())
                .where(ChatSession.project_id.in_(project_ids))
                .group_by(ChatSession.project_id)
            )
        ).all()
        return dict(rows)

    @staticmethod
    def folders(project: Project) -> list[dict]:
        """Decode the folders JSON list, returning [] when absent."""
        if not project.folders_json:
            return []
        try:
            return json.loads(project.folders_json)
        except (ValueError, TypeError):
            return []
