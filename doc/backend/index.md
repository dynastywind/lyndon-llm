# Backend — Overview

The backend is a single FastAPI application (`backend/`) that serves all three modes (Chat, Cowork, Code) over REST and Server-Sent Events. It is intentionally self-contained: one process, one SQLite database, one vector store.

---

## Architecture Graph

```
HTTP / SSE / WebSocket
        │
┌───────▼────────────────────────────────────────────────────────┐
│  API Layer                                                     │
│  ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌───────────┐  │
│  │  auth   │ │  chat  │ │cowork  │ │  code  │ │rag/sandbox│  │
│  │  routes │ │ routes │ │ routes │ │ routes │ │skills/mcp │  │
│  └────┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └─────┬─────┘  │
│       │          │          │           │             │        │
│  ┌────▼──────────▼──────────▼───────────▼─────────────▼────┐  │
│  │  Dependency Injection                                     │  │
│  │  get_current_user · get_session · get_db                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
        │                    │                      │
┌───────▼───────┐  ┌─────────▼────────┐  ┌─────────▼──────────┐
│  Chat         │  │  Cowork          │  │  Code              │
│               │  │                  │  │                    │
│  ChatEngine   │  │  Planner         │  │  RepoManager       │
│  Orchestrator │  │  Executor        │  │  Editor            │
│  MemoryMgr    │  │  shell/file/mac  │  │  Reviewer          │
│  RAG pipeline │  │  tools           │  │  TestRunner        │
│  Built-in     │  │                  │  │                    │
│  tools        │  │                  │  │                    │
└───────┬───────┘  └────────┬─────────┘  └─────────┬──────────┘
        │                   │                       │
┌───────▼───────────────────▼───────────────────────▼──────────┐
│  Core Infrastructure                                          │
│                                                               │
│  LLMGateway          — OpenAI-compatible LLM + embed calls   │
│  ToolRegistry        — per-mode tool catalogue (3 buckets)   │
│  PermissionGate      — READ / WRITE / EXEC enforcement       │
│  McpToolManager      — dynamic MCP server integration        │
│  SessionManager      — in-memory session + TTL               │
│  StreamRegistry      — SSE buffer + replay for reconnects    │
│  EventBus            — async pub/sub for lifecycle events    │
│  SchedulerRunner     — recurring tasks → unattended cowork   │
└───────────────────────────────────┬───────────────────────────┘
                                    │
┌───────────────────────────────────▼───────────────────────────┐
│  Persistence                                                  │
│                                                               │
│  SQLite (SQLAlchemy async)    ChromaDB / Qdrant               │
│  ├── users                    ├── rag_knowledge_base          │
│  ├── chat_sessions            └── long_term_memory            │
│  ├── chat_messages                                            │
│  ├── skills / skill_tools                                     │
│  ├── mcp_servers / tool_cache                                 │
│  ├── scheduled_tasks                                          │
│  └── login_records                                            │
└───────────────────────────────────────────────────────────────┘

          ┌──────────────────────────────────────────┐
          │  Runtime Services (external)             │
          │  LLM Server :52415  ·  ChromaDB :8001   │
          └──────────────────────────────────────────┘
```

---

## Module Directory

| Module | Path | Purpose | Detail doc |
|---|---|---|---|
| API | `api/` | FastAPI routes, SSE streaming, auth, dependency injection | [api.md](api.md) |
| Chat | `chat/` | Conversation engine, orchestrator, memory, RAG, built-in tools | [chat.md](chat.md) |
| Memory | `chat/memory/` | 4-tier memory: short-term, long-term, session-file, cross-session | [memory.md](memory.md) |
| RAG | `chat/rag/` | Document ingestion and hybrid retrieval | [rag.md](rag.md) |
| Cowork | `cowork/` | Goal decomposition, plan execution, automation tools | [cowork.md](cowork.md) |
| Code | `code/` | Git operations, file editing, code review, test running | [code.md](code.md) |
| Core | `core/` | LLM gateway, tool registry, permissions gate, event bus | [core.md](core.md) |
| Scheduler | `core/scheduler/` | Recurring scheduled tasks that run cowork goals unattended | [scheduler.md](scheduler.md) |
| MCP | `core/mcp/` | Model Context Protocol client and tool manager | [mcp.md](mcp.md) |
| Sessions | `core/session/` | Session lifecycle, stream buffer, reconnect | [sessions.md](sessions.md) |
| Skills | `skills/` | User-uploaded skill tools: parser, manager, argument injection | [skills.md](skills.md) |
| Sandbox | `sandbox/` | Docker/subprocess code execution runner | [sandbox.md](sandbox.md) |
| Database | `db/` | SQLAlchemy models, repositories, vector store abstraction | [db.md](db.md) |
| Config | `config/` | Pydantic settings from environment variables | [config.md](config.md) |

---

## Request Lifecycle

Every HTTP request follows this path:

```
1. HTTP request arrives at uvicorn
2. CORS middleware checks Origin header against CORS_ORIGINS list
3. FastAPI routes the request to the matching handler
4. Dependency injection:
     get_db()              → AsyncSession (SQLAlchemy)
     get_current_user()    → User ORM object (JWT validation)
     get_session()         → Session object (in-memory SessionManager)
5. Handler executes:
     Chat   → ChatEngine.stream_response() → StreamingResponse (SSE)
     Cowork → Planner.create_plan() or Executor.run()
     Code   → RepoManager / Reviewer / TestRunner
     Other  → Direct CRUD via repository layer
6. Response returned (JSON or SSE stream)
7. Background tasks fire (memory update, session persistence)
```

For chat requests, the LLM work is decoupled from the HTTP response:

```
POST /api/chat/
  ├── asyncio.create_task(_run_llm())   ← runs in background
  └── StreamingResponse                 ← SSE consumer subscribes to StreamBuffer
```

This allows the browser to disconnect and reconnect without losing tokens (see [sessions.md](sessions.md)).

---

## Entry Point

`backend/api/main.py`:
- Registers all built-in tools at startup via `_register_all_tools()`
- Applies incremental DB migrations (`_migrate()`)
- Reloads MCP servers and user skills via `mcp_tool_manager.reload_all()` and `skill_manager.reload_all()`
- Starts the scheduled-task loop via `scheduler_runner.start()` (and stops it on shutdown) — see [scheduler.md](scheduler.md)
- Mounts all route routers under `/api/*`
