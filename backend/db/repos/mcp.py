"""CRUD for MCP server registrations."""

from __future__ import annotations

from datetime import UTC, datetime
import json

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models.mcp import McpServer, McpToolCache


class McpRepo:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list_servers(self) -> list[McpServer]:
        result = await self._db.execute(
            select(McpServer).options(selectinload(McpServer.tools)).order_by(McpServer.created_at)
        )
        return list(result.scalars().all())

    async def get_server(self, server_id: str) -> McpServer | None:
        result = await self._db.execute(
            select(McpServer)
            .options(selectinload(McpServer.tools))
            .where(McpServer.id == server_id)
        )
        return result.scalar_one_or_none()

    async def create_server(
        self,
        *,
        name: str,
        description: str | None,
        transport: str,
        command: str | None,
        args: list[str],
        env: dict[str, str],
        url: str | None,
        enabled: bool,
    ) -> McpServer:
        row = McpServer(
            name=name,
            description=description,
            transport=transport,
            command=command,
            args_json=json.dumps(args),
            env_json=json.dumps(env),
            url=url,
            enabled=enabled,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def update_server(self, server_id: str, **fields) -> McpServer | None:
        row = await self.get_server(server_id)
        if row is None:
            return None
        if "args" in fields:
            row.args_json = json.dumps(fields.pop("args"))
        if "env" in fields:
            row.env_json = json.dumps(fields.pop("env"))
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        row.updated_at = datetime.now(UTC)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def delete_server(self, server_id: str) -> bool:
        row = await self.get_server(server_id)
        if row is None:
            return False
        await self._db.delete(row)
        await self._db.commit()
        return True

    async def set_last_error(self, server_id: str, error: str | None) -> None:
        row = await self.get_server(server_id)
        if row is None:
            return
        row.last_error = error
        row.updated_at = datetime.now(UTC)
        await self._db.commit()

    async def replace_tool_cache(
        self,
        server_id: str,
        tools: list[dict],
    ) -> list[McpToolCache]:
        await self._db.execute(delete(McpToolCache).where(McpToolCache.server_id == server_id))
        rows: list[McpToolCache] = []
        for t in tools:
            row = McpToolCache(
                server_id=server_id,
                mcp_name=t["mcp_name"],
                qualified_name=t["qualified_name"],
                description=t.get("description") or "",
                input_schema_json=json.dumps(t.get("input_schema") or {}),
                enabled=t.get("enabled", True),
            )
            self._db.add(row)
            rows.append(row)
        await self._db.commit()
        for row in rows:
            await self._db.refresh(row)
        return rows

    async def set_tool_enabled(
        self, server_id: str, qualified_name: str, enabled: bool
    ) -> McpToolCache | None:
        result = await self._db.execute(
            select(McpToolCache).where(
                McpToolCache.server_id == server_id,
                McpToolCache.qualified_name == qualified_name,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        row.enabled = enabled
        await self._db.commit()
        await self._db.refresh(row)
        return row
