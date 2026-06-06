# System Architecture

LyndonLLM is a local-first personal AI assistant with three operational modes — Chat, Cowork, and Code — served from a single FastAPI backend and consumed by a React SPA that can run both in-browser and as a native macOS app via Tauri.

---

## Deployment Topology

```
┌───────────────────────────────────────────────────────────────────┐
│  User Machine                                                     │
│                                                                   │
│  ┌─────────────────┐     ┌─────────────────────────────────────┐ │
│  │  Tauri Desktop  │     │  Browser (dev / web)                │ │
│  │  (macOS .app)   │     │  http://localhost:5173              │ │
│  │                 │     │                                     │ │
│  │  React SPA      │     │  React SPA                          │ │
│  │  (bundled)      │     │  (Vite dev server)                  │ │
│  └────────┬────────┘     └──────────────┬──────────────────────┘ │
│           │                             │                        │
│           │  REST + SSE  ws://          │  REST + SSE            │
│           └──────────────────┬──────────┘                        │
│                              │                                   │
│            ┌─────────────────▼──────────────────┐               │
│            │   FastAPI Backend  :8000            │               │
│            │   (uvicorn + asyncio)               │               │
│            └──┬──────────┬──────────┬────────────┘               │
│               │          │          │                            │
│    ┌──────────▼─┐ ┌──────▼──┐ ┌────▼─────────────┐             │
│    │ ChromaDB   │ │ SQLite  │ │ LLM Server        │             │
│    │ :8001      │ │ (file)  │ │ :52415 (EXO /     │             │
│    │ (vectors)  │ │         │ │  Ollama / OpenAI) │             │
│    └────────────┘ └─────────┘ └───────────────────┘             │
└───────────────────────────────────────────────────────────────────┘
```

All services run locally. ChromaDB can be swapped for Qdrant in production by changing `VECTOR_STORE_BACKEND=qdrant`.

---

## Three Operational Modes

| Mode | Purpose | Permissions | Tools |
|---|---|---|---|
| **Chat** | Conversational assistant | READ only | web_search, rag_query, render_chart, run_code, list_skills, skills, MCP |
| **Cowork** | Goal → plan → execute automation | READ + WRITE + EXEC (approval required for W/E) | shell, file_io, mac_control, web_search, rag_query |
| **Code** | Git-aware code editing and review | READ + WRITE + EXEC on repo (approval required for W/E) | file_io, shell, reviewer, test_runner |

---

## High-Level Component Map

```
Frontend (React SPA)
  │
  │  REST / SSE / WebSocket
  ▼
┌──────────────────────────────────────────────────────────────┐
│ API Layer  (api/)                                            │
│  routes: auth, chat, cowork, code, rag, sandbox, skills,     │
│          registry, ws/stream                                 │
│  middleware: JWT auth, session injection, permission gate    │
└───────────┬──────────────┬─────────────────┬────────────────┘
            │              │                 │
     ┌──────▼──────┐ ┌─────▼──────┐  ┌──────▼──────┐
     │   Chat      │ │  Cowork    │  │   Code      │
     │  (chat/)    │ │ (cowork/)  │  │  (code/)    │
     │  Engine     │ │  Planner + │  │  RepoMgr +  │
     │  Orchestr.  │ │  Executor  │  │  Editor +   │
     │  Memory     │ │            │  │  Reviewer   │
     │  RAG        │ │            │  │             │
     └──────┬──────┘ └─────┬──────┘  └──────┬──────┘
            │              │                │
     ┌──────▼──────────────▼────────────────▼──────┐
     │  Core Infrastructure  (core/)               │
     │  LLMGateway · ToolRegistry · PermissionGate │
     │  McpToolManager · SessionManager · EventBus │
     └──────────────────┬──────────────────────────┘
                        │
     ┌──────────────────▼──────────────────────────┐
     │  Persistence  (db/)                         │
     │  SQLite (SQLAlchemy async) · Vector Store   │
     │  Repos: chat, user, skill, mcp              │
     └─────────────────────────────────────────────┘
```

---

## End-to-End Chat Message Flow

```
1. User types message in ChatWindow
         │
         ▼
2. useStream.send()
   • Lazy-create session (first message)
   • Inject session prompt (first message only)
   • POST /api/chat/  { message, session_id, model, effort_mode, … }
         │
         ▼
3. API route (api/routes/chat.py)
   • Validate JWT → get_current_user (or anonymous)
   • get_session → PermissionGate(Mode.CHAT)
   • Spawn asyncio.create_task(_run_llm())
   • Return StreamingResponse (SSE)
         │
         ▼
4. ChatEngine.stream_response()
   ┌── Phase 1: Orchestrate ──────────────────────────────────────┐
   │  HeuristicOrchestrator.route(message)                        │
   │  → RouteDecision(route, tools, reason)                       │
   │  → Expand SKILL_SIGNAL → actual skill tool names             │
   └──────────────────────────────────────────────────────────────┘
   ┌── Phase 2: RAG (if needs_rag) ──────────────────────────────┐
   │  HybridRetriever.retrieve() → dense + BM25 → RRF merge      │
   │  → inject top-6 chunks into system prompt                   │
   └──────────────────────────────────────────────────────────────┘
   ┌── Phase 3: Memory ──────────────────────────────────────────┐
   │  MemoryManager.build_system_prompt()                        │
   │  → inject cross-session file + session file + LT memories   │
   └──────────────────────────────────────────────────────────────┘
   ┌── Phase 4a: Agentic loop (if needs_tools) ──────────────────┐
   │  LLMGateway.complete_with_tools_raw()  ← non-streaming call │
   │  while tool_calls and rounds < 5:                           │
   │    execute each tool → emit tool_start / tool_result events │
   │    append results to messages → call LLM again              │
   └──────────────────────────────────────────────────────────────┘
   ┌── Phase 4b: Direct stream (if route == direct or rag) ──────┐
   │  LLMGateway.stream() → yield token events                   │
   │  _ThinkingStreamParser strips <think>…</think> blocks       │
   │  → emit thinking_token vs token events                      │
   └──────────────────────────────────────────────────────────────┘
   ┌── Phase 5: Persist ─────────────────────────────────────────┐
   │  ChatRepo.add_message() (user + assistant)                  │
   │  asyncio.create_task(MemoryManager.update_session_file())   │
   └──────────────────────────────────────────────────────────────┘
   ┌── Phase 6: Metrics ─────────────────────────────────────────┐
   │  emit metrics event { total_ms, phases: {…} }               │
   └──────────────────────────────────────────────────────────────┘
         │
         ▼
5. SSE events consumed by useStream callback
   token → append to message bubble
   tool_start / tool_result → update ToolCallRecord list
   chart → append fenced chart block
   plan_preview → store ChatPlan, hide bubble
   done → stopStreaming()
```

---

## Technology Choices

| Layer | Technology | Rationale |
|---|---|---|
| Backend framework | FastAPI + uvicorn | Async-native, automatic OpenAPI docs, dependency injection |
| LLM client | OpenAI SDK (compatible) | Works with EXO, Ollama, and OpenAI without code changes |
| Relational DB | SQLite + SQLAlchemy async | Zero-infra local storage; swap URL for Postgres in prod |
| Vector store | ChromaDB (dev) / Qdrant (prod) | Local dev needs no auth; Qdrant scales to production |
| Auth | JWT HS256 + optional Google OAuth | Simple symmetric JWT for local-first use; OAuth for convenience |
| Observability | Langfuse (optional) | Plugged in at LLMGateway level; disabled when keys absent |
| Frontend framework | React 18 + TypeScript + Vite | Fast HMR, strong typing, ecosystem maturity |
| State management | Zustand + localStorage persist | Minimal boilerplate, per-session message isolation |
| UI primitives | Radix UI + Tailwind CSS | Accessible headless components + utility-first styling |
| Desktop wrapper | Tauri v2 (Rust) | Lightweight native macOS .app; shares React SPA 1:1 |
| Code editor | Monaco Editor | VS Code engine in-browser |
| SSE streaming | Native `fetch` + line parser | No library dependency; full control over reconnect/replay |
