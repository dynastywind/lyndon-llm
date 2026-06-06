# Chat Module

**Path**: `backend/chat/`
**Purpose**: Conversation loop — routing, tool orchestration, plan preview, CoT parsing, effort mode.

---

## Key Files

| File | Role |
|---|---|
| `chat/engine.py` | `ChatEngine` — main agentic loop and SSE event generator |
| `chat/orchestrator.py` | `HeuristicOrchestrator` — rule-based routing to tools / RAG / plan |
| `chat/planner.py` | `ChatPlanner` — Phase 1 plan generation for complex requests |
| `chat/executor.py` | `Executor` — step-by-step plan execution (shared with cowork) |
| `chat/tools/web_search.py` | DuckDuckGo / Google / Tavily search |
| `chat/tools/rag_query.py` | Query documents from the vector store |
| `chat/tools/chart.py` | Generate Recharts-compatible JSON specs |
| `chat/tools/run_code.py` | Execute code via the sandbox runner |
| `chat/tools/list_skills.py` | List user-installed skills from in-memory catalog |

---

## ChatEngine

`ChatEngine.stream_response()` is an async generator that yields typed SSE event dicts. It runs in a background `asyncio` task (see [api.md](api.md)) so the SSE consumer can reconnect without interrupting the LLM work.

### Six-Phase Pipeline

```
stream_response(request, session, db, user_id)
    │
    ├── 1. Orchestrate
    │       HeuristicOrchestrator.route(message, has_kb_sources)
    │       → RouteDecision(route, tools, reason)
    │       If SKILL_SIGNAL in tools:
    │           expand → actual skill__uuid__tool_name entries
    │           from tool_registry._skill_registry[Mode.CHAT]
    │
    ├── 2. RAG  (if decision.needs_rag)
    │       HybridRetriever.retrieve(query, user_id)
    │       → inject ≤ MAX_CONTEXT_CHARS into system prompt
    │
    ├── 3. Memory
    │       MemoryManager.build_system_prompt(base, user_message)
    │       → enriched system prompt
    │       MemoryManager.add_user_turn(message)
    │
    ├── 4a. Agentic loop  (if decision.needs_tools)
    │        LLMGateway.complete_with_tools_raw(messages, schemas)
    │        while tool_calls and round < MAX_TOOL_ROUNDS (5):
    │            for each call:
    │                emit tool_start event
    │                tool.run(**args)
    │                emit tool_result event
    │            append tool messages → call LLM again
    │        LLMGateway.stream(messages) → yield token events
    │
    ├── 4b. Direct stream  (if route == direct or rag)
    │        LLMGateway.stream(messages)
    │        _ThinkingStreamParser → yield token / thinking_token events
    │
    ├── 5. Persist
    │        ChatRepo.add_message(user + assistant)
    │        asyncio.create_task(MemoryManager.update_session_file())
    │        asyncio.create_task(MemoryManager.maybe_compress())
    │
    └── 6. Metrics
             emit { type: "metrics", total_ms, phases: {…} }
             emit { type: "done" }
```

### Effort Mode

Appended to the system prompt via `_EFFORT_DIRECTIVES`:

| Mode | Behaviour |
|---|---|
| `low` | Concise, minimal preamble |
| `medium` | Balanced detail (default) |
| `high` | Exhaustive, include edge cases and examples |

### Skill Override

When the frontend sends `skill_id` in the request, the engine:
1. Fetches the `Skill` + `SkillTool` records from DB
2. If the skill has scripts → pins `RouteDecision.tools` to that skill's tool names
3. If the skill is prompt-only → emits a `skill_activated` event and injects the skill body as an extra system prompt block

---

## Orchestrator

`HeuristicOrchestrator.route()` inspects the message text with regex patterns and returns a `RouteDecision`.

### Route Outcomes

| Route | Tools | Condition |
|---|---|---|
| `direct` | `{}` | No signals matched (or greeting only) |
| `rag` | `{}` | RAG signal matched, no tool signals |
| `tools` | `{…}` | Tool signals matched, no RAG signal |
| `rag_and_tools` | `{…}` | Both signals matched |
| `plan` | `{…}` | Complexity score ≥ `planner_complexity_threshold` |

### Tool Signals

| Regex | Tool added to `tool_set` |
|---|---|
| `_WEB_SEARCH_RE` | `"web_search"` |
| `_CHART_RE` | `"render_chart"` |
| `_CODE_EXEC_RE` | `"run_code"` |
| `_SKILLS_LIST_RE` | `"list_skills"` |
| `_SKILLS_RE` (elif) | `SKILL_SIGNAL` (`"__skill__"`) |

`SKILL_SIGNAL` is a sentinel. The engine expands it at request time to all registered `skill__<uuid>__<tool_name>` entries. The `_SKILLS_LIST_RE` and `_SKILLS_RE` are mutually exclusive (via `elif`) so listing queries never trigger the skill expansion.

### Complexity Scoring

```python
score = 0
if _PLAN_SEQUENTIAL_RE.search(text): score += 1   # "first … then …"
if _PLAN_EXPLICIT_RE.search(text):   score += 2   # "plan", "outline", "steps to"
if _PLAN_RESEARCH_RE.search(text):   score += 1   # "compare", "analyze", "deep dive"
if len(tool_set) >= 2:               score += 1
# route = "plan" if score >= planner_complexity_threshold (default 2)
```

---

## Chat Planner

Activated when orchestrator returns `route == "plan"`. Uses a separate LLM prompt to decompose the request into steps.

### Phase 1 — Plan Generation
```
ChatPlanner.plan(message, session, db)
    │
    LLMGateway.complete(messages, system=PLAN_SYSTEM_PROMPT)
    → raw JSON: { goal, steps: [{ id, title, description, tool?, args?, depends_on[] }] }
    → _normalize_depends_on() fixes order-number references → step UUIDs
    → emit plan_preview SSE event { plan_id, goal, steps }
```

### Phase 2 — Execution
Triggered by `POST /api/chat/plan/{plan_id}/confirm`. Uses the shared `Executor` (same as cowork) with Chat-mode tools (READ only).

---

## CoT Parser

`_ThinkingStreamParser` wraps the LLM stream. It buffers token chunks looking for `<think>` and `</think>` tags:

- Tokens inside `<think>…</think>` → emitted as `thinking_token` events (shown in a collapsible bubble)
- Tokens outside → emitted as `token` events

---

## SSE Event Types

| Event | Payload | When |
|---|---|---|
| `token` | `{ text }` | Each LLM output chunk |
| `thinking_token` | `{ text }` | CoT token inside `<think>` block |
| `tool_start` | `{ id, name, args }` | Before a tool executes |
| `tool_result` | `{ id, name, success, preview }` | After a tool returns |
| `skill_activated` | `{ skill_id }` | Prompt-only skill applied |
| `chart` | `{ spec }` | render_chart result |
| `plan_preview` | `{ plan_id, goal, steps }` | Phase 1 plan generated |
| `plan_step_started` | `{ step_id }` | Plan execution progress |
| `plan_step_done` | `{ step_id, output }` | Step completed |
| `plan_step_failed` | `{ step_id, error }` | Step failed |
| `plan_done` | `{}` | All steps finished |
| `metrics` | `{ total_ms, phases }` | End of response |
| `error` | `{ message }` | Recoverable backend error |
| `done` | `{}` | Stream complete |

---

## Integration Points

| Dependency | Used for |
|---|---|
| `HeuristicOrchestrator` | Route decision per message |
| `MemoryManager` | System prompt enrichment, turn storage, persistence |
| `HybridRetriever` | RAG context injection |
| `ToolRegistry` | Tool schema resolution and instantiation |
| `PermissionGate` | `Permission.READ` enforcement on all chat tools |
| `LLMGateway` | All LLM calls (streaming and non-streaming) |
| `ChatRepo` | Message persistence |
| `StreamBuffer` | Buffered SSE events for reconnect |
