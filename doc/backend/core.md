# Core Infrastructure

**Path**: `backend/core/`
**Purpose**: Shared foundations used by all three modes — LLM communication, tool registry, permission enforcement, session management, and inter-module events.

---

## Key Files

| File | Role |
|---|---|
| `core/llm/gateway.py` | `LLMGateway` — single OpenAI-compatible LLM client |
| `core/tools/base.py` | `BaseTool`, `ToolResult`, `@require_permission` decorator |
| `core/tools/registry.py` | `ToolRegistry` — per-mode tool catalogue |
| `core/permissions/gate.py` | `PermissionGate`, `Permission`, `Mode` |
| `core/events/bus.py` | `EventBus` — async pub/sub |

---

## LLMGateway

A module-level singleton (`llm_gateway`) that wraps the OpenAI SDK. The same client works with any OpenAI-compatible server (EXO, Ollama, OpenAI API) by pointing `LLM_BASE_URL` at the appropriate endpoint.

Optionally wraps itself in a Langfuse observability client when `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` are both set.

### Methods

| Method | Streaming | Returns | Used by |
|---|---|---|---|
| `complete(messages, system?, model?, temp?)` | No | `(str, LLMUsage)` | Memory, CoT summarisation, Planner |
| `complete_full(messages, …)` | No | `(LLMMessage, LLMUsage)` | When the full message object is needed |
| `stream(messages, system?, model?)` | Yes | `AsyncGenerator[str \| LLMUsage]` | Chat direct stream |
| `complete_with_tools_raw(messages, tools, …)` | No | `(raw_dict, LLMUsage)` | Chat agentic loop |
| `stream_from_raw(messages, …)` | Yes | `AsyncGenerator[str \| LLMUsage]` | Streaming after tool rounds |
| `embed(texts, batch_size?)` | No | `list[list[float]]` | RAG ingest and retrieval |

`LLMUsage` dataclass: `{ prompt_tokens: int, completion_tokens: int }` — accumulated across tool rounds and reported in the `metrics` event.

### Langfuse Hook

```python
# At import time (engine.py):
if settings.langfuse_secret_key and settings.langfuse_public_key:
    _langfuse_session_ctx = propagate_attributes(session_id=…)
else:
    _langfuse_session_ctx = contextmanager(lambda _: (yield))  # no-op
```

Leaving `LANGFUSE_SECRET_KEY` empty disables observability with no code changes.

---

## BaseTool

All tools extend `BaseTool` and must define:

```python
class MyTool(BaseTool):
    name: str             # tool name used in ToolRegistry and LLM schema
    description: str      # shown to the LLM
    permission: Permission  # READ | WRITE | EXEC

    @require_permission(Permission.READ)
    async def run(self, **kwargs) -> ToolResult: ...

    def schema(self) -> dict: ...  # OpenAI function-calling schema
```

At instantiation each tool receives `gate: PermissionGate` and optional `user_id: str | None`.

### ToolResult

```python
@dataclass
class ToolResult:
    tool_name: str
    success: bool
    output: Any       # serialisable result shown to the LLM
    error: str | None # error message if success=False
```

### `@require_permission` decorator

Reads `self.gate` at call time and calls `gate.check(permission, tool_name)`. Raises `PermissionDeniedError` if the current mode does not allow the required permission. This means a WRITE tool registered in Chat mode (where only READ is allowed) will be blocked at runtime even if it somehow ends up in the allowed_tools set.

---

## ToolRegistry

A module-level singleton (`tool_registry`) with three buckets per `Mode`:

```
_skill_registry  — user-uploaded skills (highest priority)
_registry        — built-in tools
_mcp_registry    — dynamic MCP tools
```

Priority on name collision: skills > built-ins > MCP.

### Registration (at startup in `api/main.py`)

```python
tool_registry.register(Mode.CHAT, WebSearchTool)
tool_registry.register(Mode.CHAT, RAGQueryTool)
tool_registry.register(Mode.CHAT, RenderChartTool)
tool_registry.register(Mode.CHAT, RunCodeTool)
tool_registry.register(Mode.CHAT, ListSkillsTool)

tool_registry.register(Mode.COWORK, ShellTool)
tool_registry.register(Mode.COWORK, MacControlTool)
tool_registry.register(Mode.COWORK, FileReadTool)
tool_registry.register(Mode.COWORK, FileWriteTool)
tool_registry.register(Mode.COWORK, RAGQueryTool)
tool_registry.register(Mode.COWORK, WebSearchTool)
tool_registry.register(Mode.COWORK, ListSkillsTool)

tool_registry.register(Mode.CODE, ShellTool)
tool_registry.register(Mode.CODE, MacControlTool)
tool_registry.register(Mode.CODE, FileReadTool)
tool_registry.register(Mode.CODE, FileWriteTool)
```

### Key Methods

| Method | Description |
|---|---|
| `register(mode, cls)` | Add a built-in tool |
| `register_skill(mode, cls)` | Add a user skill tool |
| `unregister_skill(mode, name)` | Remove a specific skill tool |
| `clear_skills(mode)` | Remove all skill tools for a mode |
| `register_mcp(mode, cls)` | Add an MCP tool |
| `unregister_mcp(mode, name)` | Remove a specific MCP tool |
| `get_tools(mode, gate, user_id)` | Return instantiated `{name: tool}` dict |
| `get_openai_schemas(mode)` | Return LLM-ready function schemas for all tools in mode |
| `list_tool_names(mode)` | Return list of registered tool names |
| `list_internal_tools(mode)` | Return metadata dicts for the Settings UI |

---

## PermissionGate

```python
class Permission(StrEnum):
    READ = "read"
    WRITE = "write"
    EXEC = "exec"

class Mode(StrEnum):
    CHAT = "chat"
    COWORK = "cowork"
    CODE = "code"
```

### Permission Matrix

| Mode | Allowed | Requires Approval |
|---|---|---|
| `CHAT` | `{READ}` | `{}` |
| `COWORK` | `{READ, WRITE, EXEC}` | `{WRITE, EXEC}` |
| `CODE` | `{READ, WRITE, EXEC}` | `{WRITE, EXEC}` |

```python
gate = PermissionGate(Mode.CHAT)
gate.check(Permission.WRITE, "FileWriteTool")  # raises PermissionDeniedError
gate.requires_approval(Permission.EXEC)        # True in COWORK/CODE, False in CHAT
gate.allowed(Permission.READ)                  # True in all modes
```

---

## EventBus

A module-level singleton (`event_bus`) providing async pub/sub for lifecycle events across modules.

```python
await event_bus.publish(Events.STEP_DONE, payload={…})
await event_bus.subscribe(Events.STEP_DONE, handler_coroutine)
```

### Event Constants (`Events`)

| Constant | Fired by | Consumed by |
|---|---|---|
| `CHAT_STARTED` | ChatEngine | Metrics, logging |
| `CHAT_DONE` | ChatEngine | Session cleanup |
| `TOOL_CALLED` | ChatEngine tool loop | Logging, metrics |
| `STEP_STARTED` | Executor | SSE router |
| `STEP_DONE` | Executor | SSE router |
| `STEP_FAILED` | Executor | SSE router |
| `TASK_DONE` | Executor | SSE router |
| `DIFF_READY` | Code editor | SSE router |
| `COMMIT_DONE` | RepoManager | SSE router |
| `DEPLOY_DONE` | deploy stub | SSE router |

---

## Integration Points

`core/` is a pure dependency — nothing in `core/` imports from `chat/`, `cowork/`, or `code/`. All cross-module wiring happens at the call sites in those packages.
