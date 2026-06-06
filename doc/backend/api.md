# API Layer

**Path**: `backend/api/`
**Purpose**: FastAPI application entry point — HTTP routes, SSE streaming, authentication, and dependency injection.

---

## Key Files

| File | Role |
|---|---|
| `api/main.py` | App factory, lifespan hooks, tool registration, route mounting |
| `api/routes/auth.py` | Register, login, OAuth, token refresh, avatar, account deletion |
| `api/routes/chat.py` | Chat stream, session CRUD, message history, RAG ingest |
| `api/routes/cowork.py` | Plan creation and execution endpoints |
| `api/routes/code.py` | Repo operations, file edits, reviews, test runs |
| `api/routes/rag.py` | Document ingest, source listing, content fetch |
| `api/routes/sandbox.py` | Code execution, language listing |
| `api/routes/skills.py` | Skill CRUD, toggle, invoke |
| `api/routes/registry.py` | Internal tool listing, MCP server management |
| `api/ws/stream.py` | WebSocket stream router for cowork/code real-time events |
| `api/auth_deps.py` | `get_current_user`, `get_optional_user` JWT dependencies |
| `api/deps.py` | `get_session`, `get_db` dependencies |

---

## Route Table

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | None | Create new account |
| `POST` | `/api/auth/login` | None | Password login → JWT |
| `POST` | `/api/auth/refresh` | JWT | Issue new token |
| `GET` | `/api/auth/google/authorize` | None | Redirect to Google OAuth |
| `GET` | `/api/auth/google/callback` | None | OAuth callback, create/find user |
| `POST` | `/api/auth/oauth/complete` | None | Complete new OAuth user signup |
| `POST` | `/api/auth/reset-password` | JWT | Change password |
| `DELETE` | `/api/auth/account` | JWT | Delete account + all data |
| `POST` | `/api/auth/avatar` | JWT | Upload avatar image |
| `DELETE` | `/api/auth/avatar` | JWT | Remove avatar |
| `GET` | `/api/auth/avatar/check` | JWT | Check if avatar exists |
| `GET` | `/api/auth/login-history` | JWT | Fetch login audit records |
| `POST` | `/api/chat/` | Optional JWT | Send message, returns SSE stream |
| `GET` | `/api/chat/resume/{session_id}` | Optional JWT | Re-attach to in-progress stream |
| `POST` | `/api/chat/sessions` | Optional JWT | Create session |
| `GET` | `/api/chat/sessions` | Optional JWT | List sessions by mode |
| `GET` | `/api/chat/sessions/{id}` | Optional JWT | Get single session |
| `DELETE` | `/api/chat/sessions/{id}` | Optional JWT | Delete session |
| `GET` | `/api/chat/messages/{session_id}` | Optional JWT | Paginated message history |
| `GET` | `/api/chat/search` | Optional JWT | Full-text session search |
| `POST` | `/api/chat/plan/{plan_id}/confirm` | Optional JWT | Execute a pending chat plan (SSE) |
| `DELETE` | `/api/chat/plan/{plan_id}` | Optional JWT | Cancel a pending plan |
| `POST` | `/api/rag/ingest` | Optional JWT | Upload + ingest document |
| `GET` | `/api/rag/sources` | Optional JWT | List ingested sources |
| `GET` | `/api/rag/content/{source}` | Optional JWT | Fetch source content (text or PDF) |
| `POST` | `/api/rag/reindex` | Optional JWT | Re-embed an existing source |
| `DELETE` | `/api/rag/sources/{source}` | Optional JWT | Remove source from vector store |
| `POST` | `/api/cowork/plan` | JWT | Create a cowork plan |
| `POST` | `/api/cowork/approve` | JWT | Approve and execute a plan |
| `POST` | `/api/code/edit` | JWT | LLM-assisted file edit |
| `POST` | `/api/code/review` | JWT | Review current diff |
| `POST` | `/api/code/test` | JWT | Run test suite |
| `GET` | `/api/code/status` | JWT | Git status |
| `GET` | `/api/code/log` | JWT | Git log |
| `GET` | `/api/code/diff` | JWT | Git diff |
| `POST` | `/api/sandbox/run` | None | Execute code snippet |
| `GET` | `/api/sandbox/languages` | None | List available languages |
| `GET` | `/api/skills/` | JWT | List user's skills |
| `POST` | `/api/skills/upload` | JWT | Upload skill ZIP |
| `PATCH` | `/api/skills/{id}/toggle` | JWT | Enable/disable skill |
| `DELETE` | `/api/skills/{id}` | JWT | Delete skill |
| `GET` | `/api/registry/tools` | JWT | List internal tools by mode |
| `GET` | `/api/registry/mcp` | JWT | List MCP servers |
| `POST` | `/api/registry/mcp` | JWT | Register MCP server |
| `DELETE` | `/api/registry/mcp/{id}` | JWT | Remove MCP server |
| `POST` | `/api/registry/mcp/{id}/refresh` | JWT | Re-discover tools for server |
| `PATCH` | `/api/registry/mcp/{id}/tools/{tool}` | JWT | Enable/disable individual MCP tool |
| `GET` | `/health` | None | Health check |
| `GET` | `/api/models` | None | List loaded LLM models (EXO/Ollama) |

---

## SSE Streaming Pattern

Chat responses are delivered as Server-Sent Events. The browser SSE protocol is simulated via a `StreamingResponse` with `Content-Type: text/event-stream`.

```
POST /api/chat/
    │
    ├── asyncio.create_task(_run_llm(engine, …))
    │       writes events → StreamBuffer.push(session_id, event)
    │
    └── StreamingResponse(_sse_generator(session_id))
            StreamBuffer.subscribe(session_id)
            → yields "event: token\ndata: {…}\n\n" per event
            → ends with "event: done\ndata: {}\n\n"
```

**Reconnect / Resume**

If the browser disconnects mid-stream, the LLM task continues writing to the `StreamBuffer`. When the frontend reconnects:

```
GET /api/chat/resume/{session_id}
    └── StreamingResponse(_sse_generator(session_id, start_idx=0))
            replays all buffered events from index 0
            then continues live until done
```

The `streaming` flag on `ChatSession` (set to `True` at start, `False` at end) tells the frontend whether a session has an in-progress stream to resume on page reload.

---

## Dependency Injection

Three FastAPI dependency functions wire context into every handler:

### `get_db()` (`api/deps.py`)
Yields an `AsyncSession` from `AsyncSessionLocal`. Commits on success, rolls back on exception.

### `get_session(x_session_id, x_mode, db)` (`api/deps.py`)
- Reads `x-session-id` and `x-mode` request headers
- Calls `SessionManager.get_or_create(session_id, mode)`
- Returns the in-memory `Session` object (which contains the `PermissionGate`)

### `get_current_user(token)` / `get_optional_user(token)` (`api/auth_deps.py`)
- Reads `Authorization: Bearer <token>` header
- Decodes and validates JWT (HS256, `JWT_SECRET_KEY`)
- `get_current_user` raises 401 if token missing/invalid
- `get_optional_user` returns `None` for unauthenticated requests (used by chat endpoints to allow anonymous use)

---

## Authentication Flow

### Password
```
POST /api/auth/register  →  bcrypt hash  →  User row  →  JWT
POST /api/auth/login     →  verify hash  →  LoginRecord  →  JWT
```

### Google OAuth
```
GET /api/auth/google/authorize
    → redirect to accounts.google.com
    → callback: GET /api/auth/google/callback
    → create or fetch User (matched by oauth_sub)
    → if new user: return oauth_pending token
    → POST /api/auth/oauth/complete { username, pending_token }
    → return final JWT
```

JWT payload: `{ sub: user_id, username, email, oauth_provider, exp }`

---

## Startup (`api/main.py` lifespan)

```python
@asynccontextmanager
async def lifespan(app):
    await _init_db()           # create tables + forward migrations
    await _clear_stale_streaming()  # reset streaming flags from prior process
    _register_all_tools()      # register all built-in tools into ToolRegistry
    await mcp_tool_manager.reload_all()   # re-discover MCP tools from DB
    await skill_manager.reload_all()      # re-register user skills from DB
    yield
```

The `_register_all_tools()` function populates `ToolRegistry` with built-in tools per mode. See [core.md](core.md) for the registry structure.
