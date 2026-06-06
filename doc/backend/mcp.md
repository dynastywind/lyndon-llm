# MCP Module

**Path**: `backend/core/mcp/`
**Purpose**: Model Context Protocol (MCP) server integration — discovery, caching, and dynamic tool registration.

---

## Key Files

| File | Role |
|---|---|
| `core/mcp/manager.py` | `McpToolManager` — load servers from DB, register tools |
| `core/mcp/client.py` | `McpClient` — connect to MCP servers, discover and call tools |
| `db/models/mcp.py` | `McpServer`, `McpToolCache` ORM models |
| `db/repos/mcp.py` | `McpRepo` — CRUD for servers and tool cache |

---

## Architecture

```
McpToolManager (singleton: mcp_tool_manager)
        │
        ├── On startup: reload_all()
        │       ├── load all enabled McpServer rows from DB
        │       └── for each server: discover_tools(server)
        │               │
        │               ▼
        │       McpClient.list_tools(server)
        │               connect (stdio / SSE transport)
        │               → list of { name, description, inputSchema }
        │               │
        │               ▼
        │       McpRepo.replace_tool_cache(server_id, tools)
        │               (clean replace — old cache deleted, new inserted)
        │               │
        │               ▼
        │       _register_dynamic_tool(server, tool_spec)
        │               → generate _McpDynamicTool class
        │               → tool_registry.register_mcp(Mode.CHAT, cls)
        │               → tool_registry.register_mcp(Mode.COWORK, cls)
        │
        └── On user request: refresh_server(server_id)
                Same flow as startup but for a single server
```

---

## Dynamic Tool Class Generation

For each discovered tool, `McpToolManager` generates a unique `BaseTool` subclass at runtime:

```python
class _McpDynamicTool(BaseTool):
    name = qualified_name          # "serverid__toolname"
    description = tool_spec["description"]
    permission = Permission.READ   # or EXEC if args suggest side effects

    async def run(self, **kwargs) -> ToolResult:
        # DB round-trip: check server.enabled before calling
        async with AsyncSessionLocal() as db:
            server = await McpRepo(db).get_server(server_id)
            if not server or not server.enabled:
                return ToolResult(success=False, error="MCP server disabled")
        result = await McpClient.call_tool(server, tool_name, kwargs)
        return ToolResult(success=True, output=result)

    def schema(self) -> dict:
        return tool_spec["inputSchema"]  # schema from MCP discovery
```

### Qualified Tool Names

To avoid collisions between tools from different servers, tool names follow the pattern:

```
<server_id_prefix>__<original_tool_name>
```

e.g., a `search` tool on a server with id `abc123` → `abc123__search`.

---

## McpClient

`McpClient` handles the wire protocol. Supports two transport types:

| Type | Config | Protocol |
|---|---|---|
| `stdio` | `command` field on `McpServer` | Subprocess stdin/stdout |
| `sse` | `url` field on `McpServer` | HTTP SSE (MCP over HTTP) |

```python
# Discovery
tools = await McpClient.list_tools(server)
# → [{ name, description, inputSchema }, …]

# Invocation
result = await McpClient.call_tool(server, tool_name, arguments)
# → raw result from MCP server
```

---

## DB Models

### `McpServer`

```python
id: UUID
user_id: str | None    # per-user server isolation
name: str
url: str | None        # SSE transport
command: str | None    # stdio transport
enabled: bool
last_error: str | None
created_at: datetime
```

### `McpToolCache`

```python
id: UUID
server_id: UUID        # FK → McpServer
qualified_name: str    # "serverid__toolname"
original_name: str     # "toolname" as the MCP server reports it
description: str
input_schema: JSON     # stored as TEXT
enabled: bool          # user can disable individual tools
```

---

## Modes

MCP tools are registered into `Mode.CHAT` and `Mode.COWORK` only. `Mode.CODE` uses a fixed tool set focused on git/file operations.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/registry/mcp` | List all MCP servers + their tools |
| `POST` | `/api/registry/mcp` | Register a new MCP server |
| `DELETE` | `/api/registry/mcp/{id}` | Remove a server and its tool cache |
| `POST` | `/api/registry/mcp/{id}/refresh` | Re-discover tools for a server |
| `PATCH` | `/api/registry/mcp/{id}/tools/{tool}` | Toggle a specific tool on/off |

---

## Error Handling

- If a server is unreachable during `reload_all()`, the error is logged to `McpServer.last_error` and the server is skipped. Existing cached tools from the DB are still registered so they fail gracefully when called rather than disappearing from the tool list.
- Each dynamic tool's `run()` makes a DB round-trip to check `server.enabled` before invoking the MCP client, so disabling a server via the UI takes effect immediately without a restart.

---

## Integration Points

| Dependency | Used for |
|---|---|
| `ToolRegistry.register_mcp()` | Inserting discovered tools per mode |
| `McpRepo` | Server CRUD and tool cache management |
| `BaseTool` | Base class for dynamic tool generation |
