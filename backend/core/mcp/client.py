"""Connect to MCP servers and list/call tools."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any

from db.models.mcp import McpServer


@dataclass
class DiscoveredMcpTool:
    name: str
    description: str
    input_schema: dict[str, Any]


def qualified_tool_name(server_id: str, mcp_tool_name: str) -> str:
    """Stable LLM-facing name; avoids collisions across servers."""
    safe = mcp_tool_name.replace("__", "_")
    return f"mcp__{server_id}__{safe}"


def _parse_args(server: McpServer) -> list[str]:
    try:
        args = json.loads(server.args_json or "[]")
        return [str(a) for a in args] if isinstance(args, list) else []
    except json.JSONDecodeError:
        return []


def _parse_env(server: McpServer) -> dict[str, str] | None:
    try:
        env = json.loads(server.env_json or "{}")
        if not env:
            return None
        return {str(k): str(v) for k, v in env.items()}
    except json.JSONDecodeError:
        return None


async def discover_tools(server: McpServer) -> list[DiscoveredMcpTool]:
    """Connect to an MCP server and return its tool list."""
    transport = server.transport.lower()
    if transport == "stdio":
        return await _discover_stdio(server)
    if transport == "sse":
        return await _discover_sse(server)
    raise ValueError(f"Unsupported transport: {server.transport}")


async def _discover_stdio(server: McpServer) -> list[DiscoveredMcpTool]:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    if not server.command:
        raise ValueError("stdio transport requires a command")

    params = StdioServerParameters(
        command=server.command,
        args=_parse_args(server),
        env=_parse_env(server),
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        response = await session.list_tools()
        return [_to_discovered(t) for t in response.tools]


async def _discover_sse(server: McpServer) -> list[DiscoveredMcpTool]:
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    if not server.url:
        raise ValueError("sse transport requires a url")

    async with sse_client(server.url) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        response = await session.list_tools()
        return [_to_discovered(t) for t in response.tools]


async def call_mcp_tool(
    server: McpServer,
    tool_name: str,
    arguments: dict[str, Any],
) -> str:
    """Execute a tool on an MCP server; returns text output for the LLM."""
    transport = server.transport.lower()
    if transport == "stdio":
        return await _call_stdio(server, tool_name, arguments)
    if transport == "sse":
        return await _call_sse(server, tool_name, arguments)
    raise ValueError(f"Unsupported transport: {server.transport}")


async def _call_stdio(server: McpServer, tool_name: str, arguments: dict[str, Any]) -> str:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(
        command=server.command or "",
        args=_parse_args(server),
        env=_parse_env(server),
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        result = await session.call_tool(tool_name, arguments=arguments)
        return _format_call_result(result)


async def _call_sse(server: McpServer, tool_name: str, arguments: dict[str, Any]) -> str:
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    async with sse_client(server.url or "") as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        result = await session.call_tool(tool_name, arguments=arguments)
        return _format_call_result(result)


def _to_discovered(tool: Any) -> DiscoveredMcpTool:
    schema = getattr(tool, "inputSchema", None) or getattr(tool, "input_schema", None) or {}
    return DiscoveredMcpTool(
        name=tool.name,
        description=getattr(tool, "description", None) or "",
        input_schema=schema if isinstance(schema, dict) else {},
    )


def _format_call_result(result: Any) -> str:
    if getattr(result, "isError", False):
        parts = []
        for block in getattr(result, "content", []) or []:
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
        return "MCP error: " + ("\n".join(parts) if parts else "unknown error")

    parts: list[str] = []
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
        elif hasattr(block, "model_dump"):
            parts.append(json.dumps(block.model_dump(), default=str))
    return "\n".join(parts) if parts else "(empty result)"
