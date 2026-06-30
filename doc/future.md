# Future Feature Plans

This document tracks planned features, ideas, and improvements. Add entries as they come up; move completed items to a "Shipped" section or delete them.

---

## Near-Term

> Features that are well-scoped and could be implemented in the current architecture with modest effort.

- [ ] **LLM Orchestrator** — replace `HeuristicOrchestrator` with an LLM-powered router (`orchestrator_strategy=llm`) using structured output to produce `RouteDecision`; heuristic remains the default fallback
- [ ] **Streaming plan execution** — Cowork executor currently streams via SSE but plan steps could emit richer progress events (percentage, elapsed time, partial output preview)
- [ ] **Session search** — full-text search across all sessions from the sidebar, not just within a single session
- [ ] **Keyboard shortcuts** — configurable hotkeys for send, new session, mode switch, open skills panel
- [ ] **MCP tool approval UI** — show a confirmation dialog before executing WRITE/EXEC MCP tools in Cowork mode, surfacing the exact arguments

---

## Medium-Term

> Features that require more design work or architectural changes.

- [ ] **Multi-model support** — allow per-session model selection with a model picker; support model-specific context windows and pricing display
- [ ] **RAG source management** — UI to tag, search, and selectively query uploaded sources; per-source enable/disable for RAG retrieval
- [ ] **Voice input / output** — integrate local Whisper for STT and a TTS model for audio responses; surfaced as a toggle in ChatWindow
- [ ] **Skill marketplace** — a catalog of community-contributed skills with one-click install; versioning and update notifications
- [ ] **Memory editing** — let users view, edit, and delete individual long-term memory entries from the Memory panel
- [ ] **Code mode: auto-commit** — option to automatically stage and commit changes made by the Code engine after user approval
- [ ] **Postgres support** — production deployment guide with Postgres as the relational backend; connection pooling via asyncpg

---

## Long-Term / Speculative

> Ideas that need substantial new infrastructure or are still conceptually loose.

- [ ] **Multi-user deployment** — shared LyndonLLM instance with per-user data isolation; admin panel for user management
- [ ] **Web deployment** — publicly accessible instance with OAuth-only login; remove local-model assumption
- [ ] **Agent-to-agent communication** — allow a Cowork plan to spawn a sub-Chat session as a research step
- [ ] **Plugin system** — structured extension point beyond MCP; plugins can register new routes, UI panels, and tool categories
- [ ] **Mobile companion** — Android/iOS app talking to the same backend API for on-the-go access. App-side changes done; see [android.md](android.md) for the Tauri v2 thin-client approach + Android/iOS run guides
- [ ] **Offline model fallback** — graceful degradation when the LLM server is unreachable; queue messages and retry
- [ ] **Audit trail** — structured log of all tool executions (args, results, timestamps) for Cowork/Code sessions; exportable as JSON

---

## Deferred / On Hold

> Items deprioritised but not abandoned.

- [ ] **Code deploy pipeline** — `code/deploy/` stub exists; intended for Vercel/Railway one-click deploy from Code mode (`VERCEL_TOKEN` setting already present)
- [ ] **LLM orchestrator strategy** — `orchestrator_strategy` setting exists but `LLMOrchestrator` raises `NotImplementedError`
