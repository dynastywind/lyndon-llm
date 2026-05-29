"""Tool registry API — internal tools + user MCP servers."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.mcp.manager import mcp_tool_manager
from core.permissions.gate import Mode
from core.tools.registry import tool_registry
from db.base import get_db
from db.repos.mcp import McpRepo

router = APIRouter()


# ── Response models ───────────────────────────────────────────────────────────


class RegistryToolOut(BaseModel):
    name: str
    description: str
    permission: str | None = None
    mode: str | None = None
    source: str  # internal | mcp
    editable: bool
    server_id: str | None = None
    server_name: str | None = None
    mcp_name: str | None = None
    enabled: bool | None = None


class McpServerToolOut(BaseModel):
    qualified_name: str
    mcp_name: str
    description: str
    enabled: bool


class McpServerOut(BaseModel):
    id: str
    name: str
    description: str | None
    transport: str
    command: str | None
    args: list[str]
    env: dict[str, str]
    url: str | None
    enabled: bool
    last_error: str | None
    tools: list[McpServerToolOut]


class RegistryOut(BaseModel):
    internal_tools: list[RegistryToolOut]
    mcp_servers: list[McpServerOut]


# ── Request models ────────────────────────────────────────────────────────────


class McpServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    transport: str = "stdio"  # stdio | sse
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    url: str | None = None
    enabled: bool = True


class McpServerUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    transport: str | None = None
    command: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None
    url: str | None = None
    enabled: bool | None = None


class McpToolToggle(BaseModel):
    enabled: bool


# ── Helpers ───────────────────────────────────────────────────────────────────


def _server_to_out(server) -> McpServerOut:
    return McpServerOut(
        id=server.id,
        name=server.name,
        description=server.description,
        transport=server.transport,
        command=server.command,
        args=json.loads(server.args_json or "[]"),
        env=json.loads(server.env_json or "{}"),
        url=server.url,
        enabled=server.enabled,
        last_error=server.last_error,
        tools=[
            McpServerToolOut(
                qualified_name=t.qualified_name,
                mcp_name=t.mcp_name,
                description=t.description,
                enabled=t.enabled,
            )
            for t in server.tools
        ],
    )


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("", response_model=RegistryOut)
async def get_registry(db: AsyncSession = Depends(get_db)):
    """Full tool registry for Settings UI."""
    internal: list[RegistryToolOut] = []
    for mode in (Mode.CHAT, Mode.COWORK, Mode.CODE):
        for t in tool_registry.list_internal_tools(mode):
            internal.append(RegistryToolOut(**t))

    repo = McpRepo(db)
    servers = await repo.list_servers()
    return RegistryOut(
        internal_tools=internal,
        mcp_servers=[_server_to_out(s) for s in servers],
    )


@router.post("/mcp/servers", response_model=McpServerOut, status_code=201)
async def create_mcp_server(body: McpServerCreate, db: AsyncSession = Depends(get_db)):
    transport = body.transport.lower()
    if transport == "stdio" and not body.command:
        raise HTTPException(400, "stdio transport requires command")
    if transport == "sse" and not body.url:
        raise HTTPException(400, "sse transport requires url")

    repo = McpRepo(db)
    server = await repo.create_server(
        name=body.name,
        description=body.description,
        transport=transport,
        command=body.command,
        args=body.args,
        env=body.env,
        url=body.url,
        enabled=body.enabled,
    )
    try:
        server = await mcp_tool_manager.refresh_server(server.id)
    except Exception as exc:
        server = await repo.get_server(server.id)
        if server:
            return _server_to_out(server)
        raise HTTPException(502, f"Connected but failed to list tools: {exc}") from exc

    return _server_to_out(server)


@router.put("/mcp/servers/{server_id}", response_model=McpServerOut)
async def update_mcp_server(
    server_id: str,
    body: McpServerUpdate,
    db: AsyncSession = Depends(get_db),
):
    repo = McpRepo(db)
    fields = body.model_dump(exclude_unset=True)
    if "transport" in fields and fields["transport"]:
        fields["transport"] = fields["transport"].lower()
    server = await repo.update_server(server_id, **fields)
    if server is None:
        raise HTTPException(404, "MCP server not found")

    mcp_tool_manager._unregister_server(server_id)
    if server.enabled:
        try:
            server = await mcp_tool_manager.refresh_server(server_id)
        except Exception:
            server = await repo.get_server(server_id)
    return _server_to_out(server)  # type: ignore[arg-type]


@router.delete("/mcp/servers/{server_id}", status_code=204)
async def delete_mcp_server(server_id: str, db: AsyncSession = Depends(get_db)):
    repo = McpRepo(db)
    if not await repo.delete_server(server_id):
        raise HTTPException(404, "MCP server not found")
    mcp_tool_manager._unregister_server(server_id)


@router.post("/mcp/servers/{server_id}/refresh", response_model=McpServerOut)
async def refresh_mcp_server(server_id: str, db: AsyncSession = Depends(get_db)):
    try:
        server = await mcp_tool_manager.refresh_server(server_id)
    except ValueError:
        raise HTTPException(404, "MCP server not found") from None
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc
    return _server_to_out(server)


@router.patch(
    "/mcp/servers/{server_id}/tools/{qualified_name}",
    response_model=McpServerToolOut,
)
async def toggle_mcp_tool(
    server_id: str,
    qualified_name: str,
    body: McpToolToggle,
    db: AsyncSession = Depends(get_db),
):
    repo = McpRepo(db)
    row = await repo.set_tool_enabled(server_id, qualified_name, body.enabled)
    if row is None:
        raise HTTPException(404, "Tool not found")
    mcp_tool_manager._unregister_server(server_id)
    server = await repo.get_server(server_id)
    if server and server.enabled:
        await mcp_tool_manager._register_server_tools(server)
    return McpServerToolOut(
        qualified_name=row.qualified_name,
        mcp_name=row.mcp_name,
        description=row.description,
        enabled=row.enabled,
    )
