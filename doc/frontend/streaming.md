# SSE Streaming

**Path**: `frontend/src/hooks/useStream.ts`, `frontend/src/api/client.ts`
**Purpose**: The SSE event contract between backend and frontend, and how the `useStream` hook consumes it.

---

## Event Contract

All events follow the SSE format:

```
event: <type>\n
data: <JSON>\n
\n
```

### Full Event Catalogue

| Event type | Payload | Description |
|---|---|---|
| `token` | `{ text: string }` | One LLM output chunk — appended to the current assistant bubble |
| `thinking_token` | `{ text: string }` | CoT chunk from inside `<think>…</think>` — appended to `message.thinking` |
| `skill_activated` | `{ skill_id: string }` | Prompt-based skill applied — adds a synthetic `ToolCallRecord` with status `"active"` |
| `tool_start` | `{ id, name, args }` | A tool is about to execute — adds `ToolCallRecord` with status `"running"` |
| `tool_result` | `{ id, name, success, preview }` | Tool finished — updates matching record to `"done"` or `"error"`, stores `preview` |
| `chart` | `{ spec: ChartSpec }` | Chart data from `render_chart` — appended as a fenced ` ```chart ` block in message content |
| `metrics` | `{ total_ms, phases: Record<string, number> }` | Performance breakdown logged to console — not shown in UI |
| `plan_preview` | `ChatPlan` | Chat planner Phase 1 complete — stores plan in store, removes empty assistant bubble |
| `plan_step_started` | `{ step_id: string }` | Execution progress — updates step status to `"running"` |
| `plan_step_done` | `{ step_id, output }` | Step completed |
| `plan_step_failed` | `{ step_id, error }` | Step failed |
| `plan_done` | `{}` | All plan steps finished |
| `error` | `{ message: string }` | Backend recoverable error — logged with `console.warn` |
| `done` | `{}` | Stream complete — `stopStreaming()`, scroll to bottom, bump session version |

---

## useStream Hook

`useStream()` returns `{ send, resume }`. It is the primary interface between UI components and the streaming API.

### `send(userMessage, attachments?, skillId?, displayContent?, skillPrefix?)`

```
1. Lazy session creation
   If sessionId is null → createChatSession(mode) → setSessionId()

2. Session prompt injection (first message only)
   Reads sessionPrompts[sessionId] or sessionPrompts['__new__']
   Passed to streamChat as appliedSessionPrompt

3. Add user bubble to store
   addSessionMessage(sessionId, { role: 'user', content: displayContent ?? userMessage, … })

4. Create empty assistant bubble with stable msgId
   Directly writes to sessionMessages[sessionId] in store

5. Build effective system prompt
   profession ? "The user is a <profession>…\n\n" + systemPrompt : systemPrompt
   (only sent on first message of a session)

6. Call streamChat(message, sessionId, callback, …)
   callback dispatches on event type → updates the assistant bubble via updateMsg()

7. finally: stopStreaming(), bumpScrollToBottom(), bumpSessionVersion()
```

### `resume(targetSessionId)`

Called on page load when `ChatSession.streaming = true` for the current session.

```
1. Add empty assistant bubble with stable msgId
2. Call resumeStream(sessionId, callback)
   Same event handling as send()
3. On error (404 / stream already done):
   Remove the empty bubble
4. finally: stopStreaming(), scroll, version bump
```

---

## Empty Bubble Pattern

Before the stream starts, `send()` creates an assistant message with `content: ''`. All subsequent `token` events append to this pre-created bubble. This avoids a visible "pop" when the first token arrives.

```typescript
const msgId = generateId()
// Insert empty bubble into sessionMessages[sessionId]
// …
const updateMsg = (updater) => {
  useAppStore.setState((s) => {
    const msgs = [...(s.sessionMessages[sessionId] ?? [])]
    const idx = msgs.findIndex((m) => m.id === msgId)
    if (idx < 0) return s
    msgs[idx] = updater(msgs[idx])
    return { sessionMessages: { ...s.sessionMessages, [sessionId]: msgs } }
  })
}
```

For `plan_preview` events, the empty bubble is **removed** from the store (the plan card takes its place).

---

## Chart Rendering

`chart` events carry a `ChartSpec` (Recharts-compatible JSON). The hook converts it to a Markdown fenced code block:

```typescript
function chartSpecToMarkdown(spec: ChartSpec): string {
  return `\n\n\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\`\n\n`
}
```

`ChatWindow` detects ` ```chart ` fenced blocks in message content and renders them with Recharts instead of showing raw JSON.

---

## Reconnect / Resume Flow

```
Page load
    │
    ├── Fetch sessions → find current session
    ├── Check ChatSession.streaming === true
    │
    └── Yes: call useStream.resume(sessionId)
            GET /api/chat/resume/{sessionId}
            Server replays all buffered events from index 0
            then continues live stream
            → same callback → same updateMsg() closure
```

This means a page refresh during a long LLM response does not lose any tokens. The buffer in `StreamBuffer` accumulates all events until `finish()` is called.

---

## Effort Mode

`effortMode` (`"low"` | `"medium"` | `"high"`) is sent as a request parameter to `streamChat`. The backend appends the corresponding `_EFFORT_DIRECTIVES` string to the system prompt. Per-session overrides take precedence over the global setting.
