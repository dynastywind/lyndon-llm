# Configuration

**Path**: `backend/config/settings.py`
**Purpose**: All application settings, loaded from environment variables or a `.env` file via Pydantic Settings.

---

## Setup

```bash
# Create .env from the template
cp backend/.env.example backend/.env
# Edit backend/.env with your values
```

Settings are loaded by `pydantic_settings.BaseSettings` in case-insensitive order:
1. Environment variables
2. `.env` file in the working directory (relative to where uvicorn starts)
3. Field defaults

The singleton `settings = Settings()` is imported by every module that needs config.

---

## Full Settings Reference

### App

| Variable | Type | Default | Description |
|---|---|---|---|
| `APP_NAME` | str | `"LyndonLLM"` | Application display name |
| `ENVIRONMENT` | enum | `development` | `development` or `production` |
| `DEBUG` | bool | `True` | Enable debug logging |

### LLM

| Variable | Type | Default | Description |
|---|---|---|---|
| `LLM_BASE_URL` | str | `http://localhost:52415/v1` | OpenAI-compatible endpoint |
| `LLM_API_KEY` | str | `"local"` | API key (ignored by local models) |
| `LLM_MODEL` | str | `"local-model"` | Model identifier in API requests |
| `LLM_MAX_TOKENS` | int | `4096` | Max completion tokens |
| `LLM_TEMPERATURE` | float | `0.7` | Sampling temperature |
| `LLM_STREAM` | bool | `True` | Enable streaming responses |

### Embeddings

| Variable | Type | Default | Description |
|---|---|---|---|
| `EMBEDDING_MODEL` | str | `"nomic-embed-text"` | Embedding model name |
| `EMBEDDING_BASE_URL` | str | `http://localhost:52415/v1` | Embedding model endpoint |
| `EMBEDDING_API_KEY` | str | `"local"` | API key for embedding server |
| `EMBEDDING_DIMENSION` | int | `768` | Vector dimensions (must match model output) |

### Vector Store

| Variable | Type | Default | Description |
|---|---|---|---|
| `VECTOR_STORE_BACKEND` | enum | `chroma` | `chroma` or `qdrant` |
| `CHROMA_HOST` | str | `"localhost"` | ChromaDB host |
| `CHROMA_PORT` | int | `8001` | ChromaDB HTTP port |
| `CHROMA_PERSIST_DIR` | str | `"./data/chroma"` | ChromaDB persistence directory |
| `QDRANT_HOST` | str | `"localhost"` | Qdrant host |
| `QDRANT_PORT` | int | `6333` | Qdrant gRPC/REST port |
| `QDRANT_API_KEY` | str | `""` | Qdrant API key (empty = no auth) |

### Database

| Variable | Type | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | str | `sqlite+aiosqlite:///./data/lyndon.db` | SQLAlchemy connection string |

> Swap to Postgres for production: `postgresql+asyncpg://user:pass@host/db`

### Memory

| Variable | Type | Default | Description |
|---|---|---|---|
| `SHORT_TERM_MAX_TOKENS` | int | `6000` | Trigger compression above this |
| `LONG_TERM_TOP_K` | int | `5` | Memories injected per turn |
| `MEMORY_CONSOLIDATION_INTERVAL` | int | `10` | Consolidate every N sessions |
| `SESSION_MEMORY_DIR` | str | `"data/session_memories"` | Per-session memory file directory |

### RAG

| Variable | Type | Default | Description |
|---|---|---|---|
| `RAG_CHUNK_SIZE` | int | `512` | Max chars per document chunk |
| `RAG_CHUNK_OVERLAP` | int | `64` | Overlap between consecutive chunks |
| `RAG_TOP_K` | int | `6` | Chunks returned per retrieval |
| `RAG_BM25_WEIGHT` | float | `0.3` | Weight for BM25 in hybrid retrieval |

### Orchestrator

| Variable | Type | Default | Description |
|---|---|---|---|
| `ORCHESTRATOR_ENABLED` | bool | `True` | Enable heuristic routing |
| `ORCHESTRATOR_STRATEGY` | str | `"heuristic"` | `heuristic` or `llm` (LLM not yet implemented) |

### Planner

| Variable | Type | Default | Description |
|---|---|---|---|
| `PLANNER_ENABLED` | bool | `True` | Enable chat plan generation |
| `PLANNER_COMPLEXITY_THRESHOLD` | int | `2` | Minimum score to trigger planning |

### Chain-of-Thought

| Variable | Type | Default | Description |
|---|---|---|---|
| `COT_ENABLED` | bool | `True` | Parse `<think>…</think>` blocks from LLM stream |

### Web Search

| Variable | Type | Default | Description |
|---|---|---|---|
| `WEB_SEARCH_PROVIDER` | str | `"duckduckgo"` | `duckduckgo`, `google`, `tavily`, `serpapi` |
| `WEB_SEARCH_MAX_RESULTS` | int | `5` | Results per search |
| `GOOGLE_API_KEY` | str | `""` | Google Custom Search API key |
| `GOOGLE_CSE_ID` | str | `""` | Google Custom Search Engine ID |
| `TAVILY_API_KEY` | str | `""` | Tavily API key (legacy) |
| `SERPAPI_API_KEY` | str | `""` | SerpAPI key (legacy) |

### Cowork

| Variable | Type | Default | Description |
|---|---|---|---|
| `COWORK_SHELL_TIMEOUT` | int | `30` | Max seconds for a shell command |
| `MAC_CONTROL_TIMEOUT` | int | `15` | Max seconds for an AppleScript call |
| `COWORK_MAX_PLAN_STEPS` | int | `20` | Max steps per cowork plan |

### Sandbox

| Variable | Type | Default | Description |
|---|---|---|---|
| `SANDBOX_TIMEOUT` | int | `60` | Max seconds per code execution |

### Code

| Variable | Type | Default | Description |
|---|---|---|---|
| `CODE_DEFAULT_REPO_PATH` | str | `""` | Default git repository path |
| `VERCEL_TOKEN` | str | `""` | Vercel deploy token (not yet used) |

### API / CORS

| Variable | Type | Default | Description |
|---|---|---|---|
| `API_HOST` | str | `"0.0.0.0"` | Bind address |
| `API_PORT` | int | `8000` | HTTP port |
| `CORS_ORIGINS` | list[str] | See below | Allowed CORS origins |

Default CORS origins:
- `http://localhost:5173` — Vite dev server
- `http://localhost:3000` — alternate dev port
- `tauri://localhost` — Tauri desktop (production build on some platforms)
- `http://tauri.localhost` — Tauri on Windows/Linux

### Session

| Variable | Type | Default | Description |
|---|---|---|---|
| `SESSION_TTL_SECONDS` | int | `86400` | Session inactivity timeout (24 h) |

### Auth — JWT

| Variable | Type | Default | Description |
|---|---|---|---|
| `JWT_SECRET_KEY` | str | `"change-me-in-production"` | **Change this in production** |
| `JWT_ALGORITHM` | str | `"HS256"` | Signing algorithm |
| `JWT_EXPIRE_DAYS` | int | `30` | Token lifetime |

### Auth — Google OAuth

| Variable | Type | Default | Description |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | str | `""` | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | str | `""` | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | str | `http://localhost:8000/api/auth/google/callback` | OAuth callback URL |
| `FRONTEND_URL` | str | `http://localhost:5173` | Frontend origin (for OAuth redirect) |
| `OAUTH_PENDING_EXPIRE_MINUTES` | int | `10` | Pending token TTL |

### Observability

| Variable | Type | Default | Description |
|---|---|---|---|
| `LANGFUSE_SECRET_KEY` | str | `""` | Langfuse secret key (leave blank to disable) |
| `LANGFUSE_PUBLIC_KEY` | str | `""` | Langfuse public key |
| `LANGFUSE_HOST` | str | `https://jp.cloud.langfuse.com` | Langfuse server URL |

---

## `VectorStoreBackend` Enum

```python
class VectorStoreBackend(StrEnum):
    chroma = "chroma"   # dev: no auth, HTTP API, local persistence
    qdrant = "qdrant"   # prod: scalable, optional API key, gRPC transport
```

Switching backends requires no code changes — only the environment variable and the corresponding host/port/key settings.

---

## Minimal `.env` for Local Development

```env
LLM_BASE_URL=http://localhost:52415/v1
LLM_MODEL=qwen2.5:32b
EMBEDDING_MODEL=nomic-embed-text
JWT_SECRET_KEY=your-random-secret-here
```

Everything else defaults to values suitable for a local single-user setup.
