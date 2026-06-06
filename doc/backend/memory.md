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
| `chat/memory/cross_session_file.py` | `CrossSessionFileMemory` — persistent user profile file |
| `chat/memory/types.py` | `Memory`, `MemoryType` (`EPISODIC`, `SEMANTIC`) |

---

## Four-Tier Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Tier 1 — Short-Term Memory (in-process, per session)        │
│                                                             │
│   Rolling list of message dicts sent to the LLM.            │
│   Compression triggered at short_term_max_tokens (6000).    │
│   Compressed summary promoted to Long-Term as EPISODIC.     │
└────────────────────────────┬────────────────────────────────┘
                             │ compress → promote
┌────────────────────────────▼────────────────────────────────┐
│ Tier 2 — Long-Term Memory (Chroma / Qdrant)                 │
│                                                             │
│   Episodic + semantic memories stored as vectors.            │
│   Retrieved by cosine similarity on each user message.      │
│   long_term_top_k (5) entries injected per turn.            │
└────────────────────────────┬────────────────────────────────┘
                             │ retrieve
┌────────────────────────────▼────────────────────────────────┐
│ Tier 3 — Session File Memory (disk, per session)            │
│                                                             │
│   Markdown file: ## Summary + ## User Profile.             │
│   Updated after each response via background task.          │
│   User Profile changes propagated to Cross-Session tier.    │
└────────────────────────────┬────────────────────────────────┘
                             │ profile propagation
┌────────────────────────────▼────────────────────────────────┐
│ Tier 4 — Cross-Session File (disk, per user)                │
│                                                             │
│   Single Markdown file: persistent user profile + key facts.│
│   Injected at the top of every system prompt.               │
│   Only updated when a new, non-placeholder profile emerges. │
└─────────────────────────────────────────────────────────────┘
```

---

## System Prompt Injection Order

`MemoryManager.build_system_prompt(base_prompt, user_message)` assembles the system prompt in this order:

```
1. base_prompt           (BASE_SYSTEM_PROMPT from engine.py)
2. + Cross-Session Memory
   (cross_session_file.load_sections() → "## User Profile / ## Key Facts")
3. + This Session's Memory
   (session_file.load(session_id) → "## Summary / ## User Profile")
4. + Relevant memories from past sessions
   (long_term.retrieve(query=user_message, top_k=5) → "- [episodic] …")
```

Each block is only appended if non-empty, so new sessions with no history receive only the base prompt.

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
| `build_system_prompt(base, message)` | Assemble enriched system prompt (async) |
| `add_user_turn(content)` | Append user message to short-term |
| `add_assistant_turn(content)` | Append assistant reply to short-term |
| `add_tool_turn(tool_name, content)` | Append tool result to short-term |
| `get_messages()` | Return current short-term message list |
| `maybe_compress()` | Auto-compress if near token limit (async) |
| `update_session_file(turns)` | Update file + sync to Chroma + maybe propagate profile (async) |
| `store_memory(content, type, importance)` | Explicitly add to long-term (async) |
| `retrieve_memories(query)` | Direct long-term retrieval (async) |
| `end_session()` | Summarise and persist the full session (async) |

---

## Short-Term Memory

`ShortTermMemory` is a list of `Turn` objects (role + content + optional tool_name). It approximates token count by character length (`len(content) // 4`).

- **Needs compression**: `total_tokens > short_term_max_tokens` (default 6000)
- **Compression**: oldest turns summarised via LLM (`SUMMARISE_SYSTEM` prompt), result replaces them; summary promoted to long-term as `EPISODIC` with importance 0.6

---

## Long-Term Memory

Backed by the vector store (same `long_term_memory` Chroma collection). Each memory is stored with metadata:

```python
{
    "session_id": str,
    "memory_type": "episodic" | "semantic",
    "importance": float,  # 0.0 – 1.0
    "user_id": str | None,
}
```

Retrieval uses cosine similarity on the embedding of the user's current message. The `user_id` metadata filter ensures isolation between users.

---

## Session File Memory

Files live in `data/session_memories/<session_id>.md`. Format:

```markdown
## Summary
The user asked about Python async patterns and we discussed...

## User Profile
- Name: …
- Profession: …
- Location: …
```

**Update flow** (runs as `asyncio.create_task` after each response):
1. Capture `old_profile` from existing file
2. LLM re-generates the full file given recent turns
3. Save updated file to disk
4. Sync updated content to Chroma (stable UUID keyed by session_id — overwrites previous entry)
5. Compare `old_profile` vs `new_profile` — if changed and contains real values, trigger cross-session update

---

## Cross-Session File Memory

Single file per user: `data/session_memories/cross_session_<user_id>.md`. Sections mirror the session file format but persist across all sessions.

**Propagation guard**: The `_has_meaningful_profile()` function checks that at least one profile field contains a non-placeholder value (not `unknown`, `none`, `n/a`, `-`). This prevents a session that never mentioned personal info from overwriting previously confirmed facts with empty placeholders.

---

## Integration Points

| Dependency | Used for |
|---|---|
| `LLMGateway.complete()` | Session summarisation and session file generation |
| `LongTermMemory` → `VectorStore` | Store and retrieve memories |
| `ChatEngine` | Called each turn for system prompt and turn storage |
