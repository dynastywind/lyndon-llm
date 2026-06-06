# Sessions Module

**Path**: `backend/core/session/`
**Purpose**: In-memory session lifecycle, streaming buffer, and SSE reconnect/replay support.

---

## Key Files

| File | Role |
|---|---|
| `core/session/manager.py` | `SessionManager` — create, retrieve, expire sessions |
| `core/session/stream_registry.py` | `StreamRegistry`, `StreamBuffer` — per-session SSE buffer |
| `db/models/chat.py` | `ChatSession` — persisted session state |

---

## Session Object

```python
@dataclass
class Session:
    session_id: str
    mode: Mode
    gate: PermissionGate     # enforces READ / WRITE / EXEC per mode
    user_id: str | None
    created_at: float        # monotonic time
    last_accessed: float     # updated on each get()
```

Sessions live in-process in `SessionManager._sessions`. They are not stored in the DB — the DB `ChatSession` table stores message history and metadata, but the in-memory `Session` is recreated on each server restart.

---

## SessionManager

A module-level singleton (`session_manager`).

```python
class SessionManager:
    _sessions: dict[str, Session]   # session_id → Session
    _ttl: int                       # SESSION_TTL_SECONDS (default 86400 = 24h)
```

### Key Methods

| Method | Description |
|---|---|
| `create(session_id, mode, user_id)` | Create a new Session with a fresh PermissionGate |
| `get(session_id)` | Retrieve session, update `last_accessed`, return None if expired |
| `get_or_create(session_id, mode, user_id)` | Idempotent — returns existing or creates new |
| `switch_mode(session_id, mode)` | Swap the mode and gate of an existing session |
| `purge_expired()` | Remove all sessions past TTL (called periodically) |

### TTL Behaviour

Sessions expire after `SESSION_TTL_SECONDS` of inactivity (not wall-clock age). Each `get()` call refreshes `last_accessed`. Expired sessions are purged lazily on subsequent `get()` or explicitly via `purge_expired()`.

---

## StreamRegistry and StreamBuffer

The streaming architecture decouples the LLM task from the SSE consumer to support reconnects:

```
LLM task (asyncio)           SSE consumer (HTTP connection)
     │                                │
     │  event_bus.publish()           │
     ▼                                │
StreamBuffer.push(event)             │
  ├── _events.append(event)          │  subscribe(start_idx)
  └── asyncio.Event.set()  ──────────▶  yield events[start_idx:]
                                        wait for new events
                                        yield live events
                                        until done flag set
```

### StreamBuffer

```python
class StreamBuffer:
    _events: list[dict]      # accumulated SSE events (never trimmed)
    _done: bool              # True when LLM task finishes
    _event: asyncio.Event    # signals new events available

    def push(event: dict) → None
    def finish() → None           # marks stream as done
    async def subscribe(start_idx=0) → AsyncGenerator[dict]
```

`subscribe(start_idx=0)` replays all events from index 0 upward, then continues live. A browser reconnect calls `subscribe(0)` to replay the full buffer.

### StreamRegistry

```python
class StreamRegistry:
    _buffers: dict[str, StreamBuffer]  # session_id → buffer

    def create(session_id) → StreamBuffer
    def get(session_id) → StreamBuffer | None
    def remove(session_id) → None
```

---

## Session `streaming` Flag

`ChatSession.streaming` (a boolean DB column) tracks whether an LLM task is currently in-flight for a session:

- Set to `True` when `_run_llm()` starts
- Set to `False` when `_run_llm()` ends (success or error)
- Cleared to `False` for all sessions at startup via `_clear_stale_streaming()`

The frontend reads this flag after a page load: if `streaming=True` for the current session, it calls `GET /api/chat/resume/{session_id}` to re-attach.

---

## Request Header Protocol

The frontend sends two headers on every chat/cowork/code request:

| Header | Value | Purpose |
|---|---|---|
| `x-session-id` | UUID string | Identifies the session to the `get_session` dependency |
| `x-mode` | `chat` / `cowork` / `code` | Determines the `Mode` and `PermissionGate` |

The `get_session()` dependency in `api/deps.py` reads these and calls `session_manager.get_or_create()`.

---

## Integration Points

| Dependency | Used for |
|---|---|
| `PermissionGate` | Created per session, scoped to its mode |
| `StreamRegistry` | Created at chat request start, removed at stream end |
| `ChatSession` DB model | Persists `streaming` flag and session metadata |
| `get_session()` dependency | Wires session into every request handler |
