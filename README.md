# LyndonLLM

A personal AI second-brain: a developer-facing chat application where an agent works over your notes, tools, and documents. Runs fully locally against [EXO](https://github.com/exo-explore/exo) or any OpenAI-compatible server.

---

## Features

### Chat
- Streaming SSE responses with tool-call rendering inline
- Multi-session management — create, rename, delete, paginate
- File & image attachments (base64, MIME-aware)
- Per-session and global system prompts
- Model selector — lists only deployed EXO models via `/ollama/api/ps`
- Markdown rendering with GFM, math (KaTeX), and syntax-highlighted code blocks
- Charts rendered inline from structured tool results (Recharts)

### Memory
- **Short-term** — rolling context window with automatic summarisation above a token limit
- **Long-term** — episodic, semantic, and procedural memories stored in the vector store; top-K injected per conversation
- **Cross-session** — persisted memory files that survive restarts
- **Per-session** — lightweight JSONL files for single-session recall

### RAG (Knowledge Base)
- Upload PDF, Markdown, TXT, Python, TypeScript, Go, Rust, Java, C/C++ files
- Hybrid retrieval — dense (embedding) + BM25 weighted blend
- Paginated document list (10 per page) with server-side search
- Pre-upload name conflict detection — "Replace" or "Skip" inline per file
- Delete removes both the disk file and all chunks from the vector store
- Re-index individual documents from the UI

### Tools (Chat Mode)
| Tool | Description |
|---|---|
| `web_search` | DuckDuckGo (or Google/Tavily/SerpAPI) with configurable result count |
| `rag_query` | Semantic + BM25 search over the user's knowledge base |
| `render_chart` | Generates bar, line, area, and pie charts rendered inline |
| `run_code` | Executes code in an isolated sandbox; output shown in the thread |

### Code Mode
- **AI-powered file editing** — natural-language instruction → unified diff applied to disk
- **Diff review** — LLM review of any diff with inline comments
- **Test runner** — run pytest / Jest; streaming output in UI
- **Git commit** — stage files and commit with a generated message
- **Repo status** — staged/unstaged file list

### Cowork Mode
- **Planner** — decomposes a high-level goal into ordered, risk-scored steps
- **Executor** — runs each step sequentially with tool access
- **Tools** — `ShellTool`, `FileReadTool`, `FileWriteTool`, `RAGQueryTool`, `WebSearchTool`

### Sandbox
- Execute code snippets directly, independent of the agent
- Supports 25+ languages via Docker isolation or local interpreter fallback

#### Supported Languages
**Interpreted:** Python · JavaScript · TypeScript · Bash · Ruby · PHP · Perl · Lua · R · Elixir · Swift · Dart · Groovy

**Compiled:** C · C++ · Java · Go · Rust · Kotlin · Scala · Haskell · OCaml · Erlang · Clojure · C# · Objective-C

### MCP (Model Context Protocol)
- Register external MCP servers by URL or command
- Enable/disable individual tools per server
- Tool calls routed through the same chat pipeline as built-in tools

### Auth
- Username / password registration & login with bcrypt hashing
- JWT tokens (HS256, 30-day expiry)
- Google OAuth 2.0 (new-user and returning-user flows)
- Login history with device ID, browser, OS, and IP detection
- Password reset endpoint
- Account deletion (cascades to sessions and memory)

### UI & Design System
- **Lyndon Vision** design system — dark gallery aesthetic with warm off-white ink and gold accent
- **Light/dark theme toggle** — persisted to `localStorage`, applied via `html.light` CSS class
- Theme toggle in sidebar footer and in Settings → Appearance
- Animated asterisk logo mark
- Responsive sidebar with tab-mode switching (Chat / Cowork / Code / Sandbox)
- Session list with inline rename, delete confirmation, streaming indicator

---

## Project Structure

```
lyndonLLM/
├── backend/                  # Python 3.11+ FastAPI application
│   ├── api/
│   │   ├── main.py           # App entrypoint, lifespan, CORS, route registration
│   │   ├── auth_deps.py      # JWT bearer dependency
│   │   ├── deps.py           # Session dependency
│   │   ├── routes/
│   │   │   ├── auth.py       # Register, login, OAuth, history, reset, delete
│   │   │   ├── chat.py       # Chat stream, sessions, messages, memory, ingest
│   │   │   ├── code.py       # Edit, commit, review, test, repo status
│   │   │   ├── cowork.py     # Plan, execute
│   │   │   ├── rag.py        # Upload, list (paginated+search), check, reindex, delete
│   │   │   ├── registry.py   # Tool registry, MCP server CRUD
│   │   │   └── sandbox.py    # Code execution, language list
│   │   └── ws/
│   │       └── stream.py     # WebSocket streaming (legacy; SSE preferred)
│   ├── chat/
│   │   ├── engine.py         # Core chat loop — routing, tool calls, memory, streaming
│   │   ├── orchestrator.py   # Heuristic + LLM route-decision (direct/rag/tools)
│   │   ├── memory/
│   │   │   ├── types.py      # MemoryType enum
│   │   │   ├── short_term.py # Rolling window + summarisation
│   │   │   ├── long_term.py  # Vector-store-backed episodic/semantic/procedural
│   │   │   ├── manager.py    # Unified retrieval + consolidation
│   │   │   ├── session_file.py
│   │   │   └── cross_session_file.py
│   │   ├── rag/
│   │   │   ├── retriever.py       # Hybrid dense+BM25 retrieval
│   │   │   └── ingestion/
│   │   │       ├── pipeline.py    # Orchestrates load → chunk → embed → upsert
│   │   │       ├── chunker.py     # Token-aware text splitter
│   │   │       └── loader.py      # PDF, plain-text, and web-page loaders
│   │   └── tools/
│   │       ├── web_search.py  # DuckDuckGo / Google / Tavily / SerpAPI
│   │       ├── rag_query.py   # Semantic knowledge-base search
│   │       ├── chart.py       # Structured chart spec → Recharts JSON
│   │       └── run_code.py    # Sandboxed code execution via sandbox.runner
│   ├── code/
│   │   ├── editor.py         # LLM-driven file edit → unified diff
│   │   ├── reviewer.py       # Diff review with inline comments
│   │   ├── test_runner.py    # pytest / Jest wrapper with streaming output
│   │   └── repo.py           # GitPython wrapper (status, stage, commit)
│   ├── cowork/
│   │   ├── planner.py        # Goal → RiskLevel-scored step list
│   │   ├── executor.py       # Sequential step execution with tool access
│   │   └── tools/
│   │       ├── shell.py       # Sandboxed shell commands
│   │       └── file_io.py     # File read/write
│   ├── core/
│   │   ├── llm/
│   │   │   └── gateway.py    # Async OpenAI-compatible client; Langfuse optional
│   │   ├── mcp/
│   │   │   ├── client.py     # MCP SSE client session
│   │   │   └── manager.py    # Server registry, tool reload
│   │   ├── permissions/
│   │   │   └── gate.py       # Permission enum, mode-based gate
│   │   ├── session/
│   │   │   └── manager.py    # In-memory session store with TTL
│   │   ├── tools/
│   │   │   ├── base.py       # BaseTool, ToolResult, @require_permission
│   │   │   └── registry.py   # Mode-scoped tool registry
│   │   └── events/
│   │       └── bus.py        # Simple in-process event bus
│   ├── db/
│   │   ├── base.py           # SQLAlchemy async engine + Base
│   │   ├── models/
│   │   │   ├── user.py       # User model
│   │   │   ├── chat.py       # ChatSession, ChatMessage models
│   │   │   ├── mcp.py        # McpServer, McpServerTool models
│   │   │   └── login_record.py # LoginRecord model
│   │   ├── repos/
│   │   │   ├── user.py       # UserRepo — CRUD + auth helpers
│   │   │   ├── chat.py       # ChatRepo — sessions, messages, pagination
│   │   │   └── mcp.py        # McpRepo — server + tool CRUD
│   │   └── vector/
│   │       └── store.py      # VectorStore protocol; Chroma + Qdrant backends
│   ├── sandbox/
│   │   └── runner.py         # LangSpec, 25+ languages, Docker + local fallback
│   ├── config/
│   │   └── settings.py       # Pydantic-settings — all env-var configuration
│   └── pyproject.toml        # Dependencies, Ruff, Mypy config
│
├── frontend/                 # React 18 + TypeScript + Vite
│   └── src/
│       ├── App.tsx            # Root: theme effect, OAuth redirect handler
│       ├── api/
│       │   └── client.ts      # All REST + SSE calls; RagSource, AuthResponse types
│       ├── components/
│       │   ├── auth/
│       │   │   ├── LoginDialog.tsx      # Register/login modal
│       │   │   └── DeleteAccountDialog.tsx
│       │   ├── chat/
│       │   │   └── ChatWindow.tsx       # Main chat UI — messages, input, model selector
│       │   ├── code/
│       │   │   └── CodeWindow.tsx       # File editor, diff viewer, test output
│       │   ├── cowork/
│       │   │   └── CoworkWindow.tsx     # Plan + execution UI
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx          # Nav, session list, profile footer
│       │   │   ├── SettingsDialog.tsx   # Knowledge Base, MCP, Prompts, Appearance tabs
│       │   │   ├── ThemeToggle.tsx      # Sun/Moon icon button
│       │   │   ├── MetricsPanel.tsx     # Token/latency charts
│       │   │   ├── MemoryPanel.tsx      # Long-term memory browser
│       │   │   └── ToolsRegistryPanel.tsx
│       │   ├── sandbox/
│       │   │   └── SandboxWindow.tsx    # Manual code execution UI
│       │   └── ui/
│       │       └── Badge.tsx
│       ├── config/
│       │   └── codeThemes.ts    # Syntax theme registry (VS Code Dark+, Dracula, …)
│       ├── hooks/
│       │   ├── useStream.ts     # SSE streaming hook
│       │   └── useChatHistory.ts
│       ├── store/
│       │   └── index.ts         # Zustand store — auth, sessions, messages, theme
│       └── types/
│           └── index.ts         # Shared TypeScript types
│
└── desktop/                  # Tauri v2 wrapper for macOS desktop build
    └── src-tauri/
        ├── Cargo.toml
        └── tauri.conf.json
```

---

## API Reference

### Auth — `/api/auth`
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/check-username` | Check username availability |
| `POST` | `/register` | Create account, returns JWT |
| `POST` | `/login` | Password login, returns JWT; records device/IP |
| `GET` | `/login-history` | Paginated login history for current user |
| `POST` | `/reset-password` | Reset password by username |
| `GET` | `/google/authorize` | Initiate Google OAuth flow |
| `GET` | `/google/callback` | OAuth callback; redirects with token |
| `POST` | `/oauth/complete` | Complete new Google user signup |
| `DELETE` | `/me` | Delete account and all data |

### Chat — `/api/chat`
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | Stream a chat message (SSE) |
| `POST` | `/sessions` | Create a new session |
| `GET` | `/sessions` | List sessions (paginated, mode-filtered) |
| `PATCH` | `/sessions/:id` | Rename session |
| `DELETE` | `/sessions/:id` | Delete session + messages |
| `GET` | `/sessions/:id/messages` | Paginated message history (cursor-based) |
| `GET` | `/sessions/:id/messages/all` | Full history (no limit) |
| `GET` | `/memory` | Retrieve memories by query for current session |
| `GET` | `/memories` | List all long-term memories for user |
| `DELETE` | `/memories/:id` | Delete a memory |

### RAG — `/api/rag`
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload and ingest a file into the vector store |
| `GET` | `/sources/check` | Check if a filename already exists for this user |
| `GET` | `/sources` | Paginated, searchable source list (`limit`, `offset`, `query`) |
| `POST` | `/reindex` | Re-ingest an existing uploaded file |
| `DELETE` | `/sources` | Remove source chunks from vector store + delete file |

### Code — `/api/code`
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/edit` | AI-driven file edit — returns unified diff |
| `POST` | `/commit` | Stage and commit files with message |
| `POST` | `/review` | LLM review of a diff |
| `POST` | `/test` | Run test suite, streaming output |
| `GET` | `/status` | Git repo status |

### Cowork — `/api/cowork`
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/plan` | Generate a step-by-step plan for a goal |
| `POST` | `/execute` | Execute a plan by ID |

### Sandbox — `/api/sandbox`
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/run` | Execute code in an isolated sandbox |
| `GET` | `/languages` | List supported languages with availability flags |

### Registry — `/api/registry`
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Full tool registry (built-in + MCP) |
| `POST` | `/mcp/servers` | Register an MCP server |
| `PUT` | `/mcp/servers/:id` | Update an MCP server |
| `DELETE` | `/mcp/servers/:id` | Remove an MCP server |
| `POST` | `/mcp/servers/:id/refresh` | Reload tools from an MCP server |
| `PATCH` | `/mcp/servers/:id/tools/:name` | Enable/disable a tool |

### Models — `/api/models`
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | List deployed EXO models via `/ollama/api/ps` |

---

## Configuration

All settings are read from environment variables or a `.env` file in `backend/`.

| Variable | Default | Description |
|---|---|---|
| `LLM_BASE_URL` | `http://localhost:52415/v1` | OpenAI-compatible inference endpoint |
| `LLM_MODEL` | `local-model` | Model name passed in API requests |
| `LLM_MAX_TOKENS` | `4096` | Max completion tokens |
| `LLM_TEMPERATURE` | `0.7` | Sampling temperature |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |
| `EMBEDDING_BASE_URL` | `http://localhost:52415/v1` | Embedding endpoint |
| `EMBEDDING_DIMENSION` | `768` | Vector dimension |
| `VECTOR_STORE_BACKEND` | `chroma` | `chroma` or `qdrant` |
| `CHROMA_PERSIST_DIR` | `./data/chroma` | Chroma data directory |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/lyndon.db` | SQLite (or Postgres) URL |
| `JWT_SECRET_KEY` | `change-me-in-production` | **Change this in production.** Also derives the memory-at-rest encryption key — see rotation note below |
| `JWT_EXPIRE_DAYS` | `30` | JWT TTL |
| `MEMORY_ENCRYPTION_ENABLED` | `true` | Encrypt PII-bearing memory at rest |
| `GOOGLE_CLIENT_ID` | _(empty)_ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | _(empty)_ | Google OAuth client secret |
| `LANGFUSE_SECRET_KEY` | _(empty)_ | Langfuse observability (leave blank to disable) |
| `LANGFUSE_PUBLIC_KEY` | _(empty)_ | Langfuse public key |
| `WEB_SEARCH_PROVIDER` | `duckduckgo` | `duckduckgo` / `google` / `tavily` / `serpapi` |
| `SANDBOX_TIMEOUT` | `60` | Max seconds per sandbox run |
| `CORS_ORIGINS` | `localhost:5173, localhost:3000` | Allowed origins |

> **Rotating `JWT_SECRET_KEY`:** it also derives the memory-at-rest encryption
> key, so rotating it makes existing memory unreadable unless you re-key first.
> Run `scripts/rekey_memory.py` as part of the rotation — see
> [`doc/RUNBOOK.md`](doc/RUNBOOK.md).

---

## Getting Started

### Prerequisites
- Python 3.11+
- Node 20+
- [EXO](https://github.com/exo-explore/exo) (or any OpenAI-compatible server) running on port 52415
- ChromaDB running on port 8001 (or set `VECTOR_STORE_BACKEND=qdrant`)
- Docker (optional, for compiled-language sandbox isolation)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # edit as needed
uvicorn api.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

### Desktop (macOS)

```bash
cd desktop
npm install
npm run tauri dev      # bundles frontend + opens native window
```

---

## Development

### Backend linting & type-checking
```bash
cd backend
ruff check .           # lint
ruff format .          # format
mypy .                 # type check
pytest                 # tests
```

### Frontend linting
```bash
cd frontend
npm run lint
npm run format
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | FastAPI + Uvicorn |
| LLM client | OpenAI Python SDK (OpenAI-compatible) |
| Observability | Langfuse (optional) |
| Vector store | ChromaDB (default) / Qdrant |
| Relational DB | SQLite via SQLAlchemy async + aiosqlite |
| Auth | bcrypt + python-jose JWT + Authlib OAuth |
| RAG | Custom hybrid (dense + BM25) retrieval |
| MCP | `mcp` SDK — SSE client |
| Sandbox | Docker isolation + local interpreter fallback |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + Lyndon Vision design tokens |
| State | Zustand (persisted) |
| UI primitives | Radix UI |
| Charts | Recharts |
| Markdown | react-markdown + remark-gfm + KaTeX |
| Animation | Framer Motion |
| Desktop | Tauri v2 (macOS) |
| Linting | Ruff + Mypy (backend) · ESLint + Prettier (frontend) |
