# Memory Module

**Path**: `backend/chat/memory/`
**Purpose**: Four-tier memory architecture that builds the system prompt for each conversation turn and persists learned facts across sessions.

---

## Key Files

| File | Role |
|---|---|
| `chat/memory/manager.py` | `MemoryManager` — unified interface over all four tiers |
| `chat/memory/short_term.py` | `ShortTermMemory` — rolling in-memory conversation window |
| `chat/memory/long_term.py` | `LongTermMemory` — vector store (Chroma/Qdrant) |
| `chat/memory/session_file.py` | `SessionFileMemory` — per-session Markdown summary file |
| `chat/memory/cross_session_file.py` | `CrossSessionFileMemory` — persistent per-user profile file |
| `chat/memory/types.py` | `Memory`, `ConversationTurn`, `MemoryType` (`EPISODIC`, `SEMANTIC`, `PROCEDURAL`) |

---

## Four-Tier Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Tier 1 — Short-Term Memory (in-process, per session)        │
│                                                             │
│   Rolling list of ConversationTurn objects sent to the LLM.│
│   Compression triggered at short_term_max_tokens (6000).    │
│   Compressed summary promoted to Long-Term as EPISODIC.     │
└────────────────────────────┬────────────────────────────────┘
                             │ compress → promote
┌────────────────────────────▼────────────────────────────────┐
│ Tier 2 — Long-Term Memory (Chroma / Qdrant)                 │
│                                                             │
│   episodic / semantic / procedural memories as vectors.     │
│   Retrieved by similarity on each user message.             │
│   long_term_top_k (5) entries injected per turn.            │
└────────────────────────────┬────────────────────────────────┘
                             │ retrieve
┌────────────────────────────▼────────────────────────────────┐
│ Tier 3 — Session File Memory (disk, per session)            │
│                                                             │
│   Markdown file: ## Conversation Summary + ## User Profile.│
│   Updated after each response via background task.          │
│   User Profile changes propagated to Cross-Session tier.    │
└────────────────────────────┬────────────────────────────────┘
                             │ profile propagation
┌────────────────────────────▼────────────────────────────────┐
│ Tier 4 — Cross-Session File (disk, per user)                │
│                                                             │
│   Single Markdown file: persistent user profile + key facts.│
│   Profile merged into every system prompt.                  │
│   Only updated when a new, non-placeholder profile emerges. │
└─────────────────────────────────────────────────────────────┘
```

---

## System Prompt Injection Order

`MemoryManager.build_system_prompt(base_prompt, user_message)` (async) assembles the prompt as follows. The cross-session file **and** the session file each carry a `## User Profile`; rather than emit two (possibly conflicting) blocks, they are **merged in Python** into a single authoritative profile — session values override cross-session values for the same key, because they are more recent.

```
1. base_prompt              (BASE_SYSTEM_PROMPT from engine.py)
2. + ## User Profile        (merged cross-session + session profile — emitted once)
3. + ## Key Facts           (from the cross-session file, accumulates over time)
4. + ## This Session's Summary
                            (the session file's "## Conversation Summary" body)
5. + ## Relevant memories from past sessions
                            (long_term.retrieve(top_k=long_term_top_k) → "- [type] snippet")
```

Each block is appended only if non-empty, so a brand-new session with no history receives only the base prompt. Long-term retrieval is always scoped: logged-in users filter by `user_id`; anonymous users fall back to their own `session_id` so they can never pull the cross-user pool.

---

## MemoryManager

```python
class MemoryManager:
    session_id: str
    user_id: str | None
    short_term: ShortTermMemory
    long_term: LongTermMemory
    session_file: SessionFileMemory
    cross_session_file: CrossSessionFileMemory
```

### Key Methods

| Method | Description |
|---|---|
| `build_system_prompt(base, message)` | Assemble the enriched system prompt (async) |
| `add_user_turn(content)` | Append a user message to short-term |
| `add_assistant_turn(content)` | Append an assistant reply to short-term |
| `add_tool_turn(tool_name, content)` | Append a tool result to short-term |
| `get_messages()` | Return the current short-term message list (LLM dicts) |
| `maybe_compress()` | Auto-compress if near the token limit (async) |
| `update_session_file(turns)` | Regenerate file + sync to Chroma + maybe propagate profile (async) |
| `store_memory(content, type, importance)` | Explicitly add to long-term (async) |
| `retrieve_memories(query)` | Direct long-term retrieval, scoped by `user_id` (async) |
| `end_session()` | Summarise and persist the full session (async) |

---

## Short-Term Memory

`ShortTermMemory` holds a list of `ConversationTurn` objects (`role`, `content`, `timestamp`, optional `tool_name`, `token_count`). It approximates token count by character length (`len(content) // 4`).

- **Needs compression**: `total_tokens > short_term_max_tokens` (default 6000)
- **Compression**: the oldest turns are summarised via the LLM, the result replaces them, and the summary is promoted to long-term as `EPISODIC` with `importance = 0.6`
- **`last_n(n)`**: return the last *n* turns (used by `end_session()`)

---

## Long-Term Memory

Backed by the vector store (`long_term_memory` collection). Each memory is stored with metadata:

```python
{
    "session_id": str,
    "memory_type": "episodic" | "semantic" | "procedural",
    "importance": float,        # 0.0 – 1.0
    "created_at": str,          # ISO-8601
    "user_id": str | None,      # when known
    "enc_scope": str,           # scope used to encrypt content (user_id or session_id)
}
```

Memory **content is encrypted at rest** when `memory_encryption_enabled` is true; `enc_scope` records the scope used so it can be decrypted later. Retrieval uses similarity on the embedding of the user's current message, with the `user_id` (or fallback `session_id`) filter ensuring isolation between users.

The `Memory` model (`types.py`) also tracks `id`, `last_accessed`, `access_count`, `metadata`, and a lazily-populated `embedding`; `touch()` bumps the access counters.

---

## Session File Memory

Files live in `data/session_memories/<session_id>.md` (`session_memory_dir`). Format:

```markdown
## Conversation Summary
The user asked about Python async patterns and we discussed...

## User Profile
- Name: …
- Profession: …
- Location: …
```

**Update flow** (runs as an `asyncio` background task after each response, in `update_session_file`):
1. Capture `old_profile` from the existing file
2. The LLM regenerates the full file given recent turns; save it to disk
3. **Best-effort** sync to Chroma under a stable UUID keyed by `session_id` (`uuid5`, overwrites the previous entry) — wrapped in try/except so a Chroma failure never blocks step 4
4. Compare `old_profile` vs the new profile — if it changed **and** contains real values, propagate to the cross-session tier

---

## Cross-Session File Memory

One file per user: `data/session_memories/cross_session_<user_id>.md`. Sections mirror the session file (`## User Profile`, `## Key Facts`) but persist across all of that user's sessions.

**Propagation guard**: `_has_meaningful_profile()` requires at least one profile field to hold a non-placeholder value (not `unknown`, `none`, `n/a`, `-`). This prevents a session that never mentioned personal info from overwriting previously confirmed facts with empty placeholders.

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `short_term_max_tokens` | `6000` | Token threshold that triggers summarisation |
| `long_term_top_k` | `5` | Memories injected per conversation turn |
| `memory_consolidation_interval` | `10` | Consolidate every N sessions |
| `session_memory_dir` | `"data/session_memories"` | Directory for session / cross-session files |
| `memory_encryption_enabled` | `True` | Encrypt long-term memory content at rest |

---

## Integration Points

| Dependency | Used for |
|---|---|
| `llm_gateway.complete()` | Session summarisation and session-file generation |
| `LongTermMemory` → `VectorStore` (`long_term_memory`) | Store and retrieve memories |
| `ChatEngine` | Called each turn for the system prompt and turn storage |
