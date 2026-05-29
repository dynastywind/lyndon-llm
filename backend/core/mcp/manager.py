"""Runtime registry for MCP servers and dynamic tool classes."""
from __future__ import annotations

import json
import logging
from typing import Any

from core.mcp.client import call_mcp_tool, discover_tools, qualified_tool_name
from core.permissions.gate import Mode, Permission, PermissionGate
from core.tools.base import BaseTool, ToolResult
from core.tools.registry import tool_registry
from db.base import AsyncSessionLocal
from db.models.mcp import McpServer, McpToolCache
from db.repos.mcp import McpRepo

logger = logging.getLogger(__name__)

_MCP_MODES = (Mode.CHAT, Mode.COWORK)


class McpToolManager:
    def __init__(self) -> None:
        self._tool_meta: dict[str, dict[str, Any]] = {}

    async def reload_all(self) -> None:
        """Load all enabled MCP servers from DB and register their tools."""
        self._clear_mcp_tools()
        async with AsyncSessionLocal() as db:
            repo = McpRepo(db)
            servers = await repo.list_servers()
            for server in servers:
                if server.enabled:
                    await self._register_server_tools(server)

    async def refresh_server(self, server_id: str) -> McpServer:
        """Reconnect, refresh tool cache in DB, and re-register runtime tools."""
        async with AsyncSessionLocal() as db:
            repo = McpRepo(db)
            server = await repo.get_server(server_id)
            if server is None:
                raise ValueError(f"MCP server not found: {server_id}")

            try:
                discovered = await discover_tools(server)
                cache_rows = [
                    {
                        "mcp_name": t.name,
                        "qualified_name": qualified_tool_name(server_id, t.name),
                        "description": t.description,
                        "input_schema": t.input_schema,
                        "enabled": True,
                    }
                    for t in discovered
                ]
                await repo.replace_tool_cache(server_id, cache_rows)
                await repo.set_last_error(server_id, None)
                server = await repo.get_server(server_id)
                assert server is not None
            except Exception as exc:
                await repo.set_last_error(server_id, str(exc))
                raise

        self._unregister_server(server_id)
        if server.enabled:
            await self._register_server_tools(server)
        return server

    async def _register_server_tools(self, server: McpServer) -> None:
        for cached in server.tools:
            if not cached.enabled:
                continue
            self._register_one_tool(server, cached)

    def _register_one_tool(self, server: McpServer, cached: McpToolCache) -> None:
        qname = cached.qualified_name
        try:
            input_schema = json.loads(cached.input_schema_json or "{}")
        except json.JSONDecodeError:
            input_schema = {}

        server_id = server.id
        mcp_name = cached.mcp_name
        description = cached.description or f"MCP tool from {server.name}"

        class _McpDynamicTool(BaseTool):
            name = qname
            description = description
            permission = Permission.READ

            async def run(self, **kwargs: Any) -> ToolResult:
                async with AsyncSessionLocal() as db:
                    repo = McpRepo(db)
                    srv = await repo.get_server(server_id)
                    if srv is None or not srv.enabled:
                        return ToolResult(
                            tool_name=qname,
                            success=False,
                            output=None,
                            error="MCP server is not available",
                        )
                    try:
                        text = await call_mcp_tool(srv, mcp_name, kwargs)
                        return ToolResult(tool_name=qname, success=True, output=text)
                    except Exception as exc:
                        return ToolResult(
                            tool_name=qname,
                            success=False,
                            output=None,
                            error=str(exc),
                        )

            def schema(self) -> dict[str, Any]:
                params = (
                    input_schema
                    if input_schema.get("type") == "object"
                    else {"type": "object", "properties": input_schema or {}}
                )
                return {
                    "name": qname,
                    "description": description,
                    "parameters": params,
                }

        self._tool_meta[qname] = {
            "server_id": server_id,
            "server_name": server.name,
            "mcp_name": mcp_name,
        }
        for mode in _MCP_MODES:
            tool_registry.register_mcp(mode, _McpDynamicTool)

    def _unregister_server(self, server_id: str) -> None:
        to_remove = [
            qname for qname, meta in self._tool_meta.items()
            if meta["server_id"] == server_id
        ]
        for qname in to_remove:
            self._tool_meta.pop(qname, None)
            for mode in _MCP_MODES:
                tool_registry.unregister_mcp(mode, qname)

    def _clear_mcp_tools(self) -> None:
        for mode in _MCP_MODES:
            tool_registry.clear_mcp(mode)
        self._tool_meta.clear()


mcp_tool_manager = McpToolManager()
