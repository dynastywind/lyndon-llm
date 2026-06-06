# Database Layer

**Path**: `backend/db/`
**Purpose**: Relational persistence (SQLite via SQLAlchemy async), repositories, and the vector store abstraction for RAG and long-term memory.

---

## Key Files

| File | Role |
|---|---|
| `db/base.py` | Engine, `AsyncSessionLocal`, `Base` declarative class |
| `db/models/user.py` | `User` model |
| `db/models/chat.py` | `ChatSession`, `ChatMessage` models |
| `db/models/skill.py` | `Skill`, `SkillTool` models |
| `db/models/mcp.py` | `McpServer`, `McpToolCache` models |
| `db/models/cowork.py` | `CoworkPlan` model |
| `db/models/login_record.py` | `LoginRecord` model |
| `db/repos/chat.py` | `ChatRepo` — session and message CRUD |
| `db/repos/user.py` | `UserRepo` — user CRUD |
| `db/repos/skill.py` | `SkillRepo` — skill CRUD |
| `db/repos/mcp.py` | `McpRepo` — MCP server and tool cache |
| `db/vector/store.py` | Vector store abstraction + Chroma/Qdrant backends |

---

## SQLAlchemy Setup

```python
# db/base.py
engine = create_async_engine(settings.database_url)  # SQLite by default
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession)
Base = DeclarativeBase()
```

The `get_db()` dependency yields an `AsyncSession` per request. All queries use `async with AsyncSessionLocal() as db`.

---

## ORM Models

### `User`

```
id           UUID (PK)
username     string, unique
hashed_password  string (bcrypt, nullable for OAuth-only)
email        string, nullable
avatar       BLOB, nullable
oauth_provider   string ("google" | null)
oauth_sub    string (provider user ID, nullable)
created_at   datetime
updated_at   datetime
```

### `ChatSession`

```
id           UUID (PK)
mode         string ("chat" | "cowork" | "code")
title        string, nullable (auto-generated from first message)
user_id      UUID FK → users (nullable for anonymous)
streaming    bool (True while LLM task is running)
created_at   datetime
updated_at   datetime
```

### `ChatMessage`

```
id               UUID (PK)
session_id       UUID FK → chat_sessions
role             string ("user" | "assistant" | "tool")
content          text
attachments_json text (JSON array of { name, type, data })
tool_calls_json  text (JSON array of ToolCallRecord)
skill_prefix     string (skill display prefix, nullable)
created_at       datetime
```

### `Skill`

```
id           UUID (PK)
user_id      UUID FK → users
name         string
description  text
version      string
enabled      bool
skill_md     text (raw SKILL.md file content)
created_at   datetime
```

### `SkillTool`

```
id                   UUID (PK)
skill_id             UUID FK → skills
tool_name            string
language             string ("python" | "javascript" | "typescript" | "bash" | "shell")
script_content       text
parameters_schema_json  text (JSON schema)
```

### `McpServer`

```
id           UUID (PK)
user_id      UUID FK → users (nullable)
name         string
url          string (SSE transport, nullable)
command      string (stdio transport, nullable)
enabled      bool
last_error   text, nullable
created_at   datetime
```

### `McpToolCache`

```
id                UUID (PK)
server_id         UUID FK → mcp_servers
qualified_name    string ("serverid__toolname")
original_name     string
description       text
input_schema      text (JSON)
enabled           bool
```

### `CoworkPlan`

```
id           UUID (PK)
session_id   UUID FK → chat_sessions
goal         text
steps_json   text (JSON array of PlanStep)
approved     bool
created_at   datetime
```

### `LoginRecord`

```
id           UUID (PK)
user_id      UUID FK → users
device_id    string
browser      string
os           string
user_agent   text
ip_address   string
created_at   datetime
```

---

## Repository Patterns

Each repo takes an `AsyncSession` in its constructor: `ChatRepo(db)`.

### `ChatRepo` — Notable Patterns

**Cursor-based pagination** for message history (avoids OFFSET on large tables):
```python
get_messages_before(session_id, before_id, limit=20)
# → messages with id < before_id, ordered by created_at DESC, limit N
```

**Full-text search with snippets**:
```python
search_sessions(user_id, query, mode?, limit=20)
# → sessions where any message content LIKE %query%
# → returns session rows with a matched snippet
```

**Streaming flag management**:
```python
set_streaming(session_id, True)   # mark LLM task started
set_streaming(session_id, False)  # mark LLM task finished
clear_all_streaming()             # called at startup to reset stale flags
```

---

## Vector Store Abstraction

Two Chroma collections serve different purposes:

| Collection | Used by | Content |
|---|---|---|
| `rag_knowledge_base` | RAG pipeline | User-uploaded document chunks |
| `long_term_memory` | MemoryManager | Episodic + semantic memories |

### `VectorStoreBase` Interface

```python
async def upsert(ids, embeddings, documents, metadatas) → None
async def query(query_embeddings, n_results, where?) → QueryResult
async def delete(ids) → None
async def delete_by_source(source, user_id?) → None
async def list_sources(user_id?) → list[str]
async def list_all(limit?) → list[dict]
```

### `ChromaVectorStore`

- HTTP client connecting to `chroma_host:chroma_port` (default `localhost:8001`)
- Lazy initialisation — connects on first operation
- No authentication required in dev mode
- Collections use cosine similarity distance

### `QdrantVectorStore`

- gRPC/REST client connecting to `qdrant_host:qdrant_port` (default `localhost:6333`)
- Auto-creates collection on init if missing
- Point IDs are 64-bit integers (hashed from UUID strings)
- Original UUID preserved in payload as `_id` field
- Optional `qdrant_api_key` for authenticated deployments

### Factory and Caching

```python
# db/vector/store.py
_instances: dict[str, VectorStoreBase] = {}

async def get_vector_store(collection_name: str) → VectorStoreBase:
    if collection_name not in _instances:
        _instances[collection_name] = _create(collection_name)
    return _instances[collection_name]
```

One singleton per collection name, created lazily on first access.

---

## Migrations

Forward-only incremental migrations are applied at startup (`_migrate()` in `api/main.py`). Each statement is wrapped in `with suppress(Exception)` so running it twice is harmless:

| Version | Change |
|---|---|
| v2 | `attachments_json` on `chat_messages` |
| v3 | `user_id` on `mcp_servers` and `chat_sessions` |
| v4 | Indexes on `login_records` |
| v5 | `oauth_provider`, `oauth_sub` on `users` |
| v6 | `email` on `users` |
| v7 | `avatar` BLOB on `users` |
| v8 | `skill_md` on `skills` |
| v9 | `tool_calls_json`, `skill_prefix` on `chat_messages` |
| v10 | `streaming` bool on `chat_sessions` |

---

## Integration Points

| Dependency | Used for |
|---|---|
| `AsyncSessionLocal` | Request-scoped DB sessions via `get_db()` |
| `VectorStore` | RAG chunks and memory vectors |
| `LLMGateway.embed()` | Generating vectors for storage and retrieval |
