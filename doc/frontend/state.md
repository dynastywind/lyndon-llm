# Frontend State

**Path**: `frontend/src/store/index.ts`
**Purpose**: Zustand global store — application state, per-session message isolation, and localStorage persistence.

---

## Store Setup

```typescript
export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({ … }),
    {
      name: 'lyndon-llm-store',      // localStorage key
      partialize: (s) => ({          // only persist these fields
        user, sessionId, repoPath, codeTheme, uiTheme,
        systemPrompt, profession, selectedModel, effortMode,
        sessionEffortModes, appliedSessionPrompts,
        avatarVersion,
      }),
    }
  )
)
```

Fields not in `partialize` are **ephemeral** — reset on page load.

---

## AppState Shape

### Auth

| Field | Type | Persisted | Description |
|---|---|---|---|
| `user` | `User \| null` | Yes | Logged-in user (JWT token, username, id) |
| `pendingOAuthToken` | `string \| null` | No | Pending OAuth token for new-user completion |

### Session

| Field | Type | Persisted | Description |
|---|---|---|---|
| `sessionId` | `string \| null` | Yes | Current active session UUID |
| `mode` | `"chat" \| "cowork" \| "code" \| "sandbox"` | No | Current app mode |
| `sessionTitle` | `string \| null` | No | Displayed in the sidebar header |
| `sessionListVersion` | `number` | No | Incremented to trigger session list refresh |
| `scrollToBottomTick` | `number` | No | Incremented to trigger auto-scroll |

### Messages (per session)

| Field | Type | Persisted | Description |
|---|---|---|---|
| `sessionMessages` | `Record<string, Message[]>` | No | All messages keyed by session ID |
| `streamingSet` | `Set<string>` | No | Set of session IDs currently streaming |

**Per-session keying** prevents cross-session bleed when the user switches sessions mid-stream. Each session's messages are read as `sessionMessages[sessionId] ?? []`.

### Cowork / Plan State

| Field | Type | Persisted | Description |
|---|---|---|---|
| `currentPlan` | `Plan \| null` | No | Active cowork plan |
| `chatPendingPlan` | `ChatPlan \| null` | No | Chat plan awaiting user confirmation |
| `chatPlanStatus` | `"pending_confirm" \| "executing" \| "done" \| null` | No | Plan lifecycle state |
| `chatPlanStepStatuses` | `Record<string, StepStatus>` | No | Per-step status map |

### Settings

| Field | Type | Persisted | Description |
|---|---|---|---|
| `systemPrompt` | `string` | Yes | Global system prompt (prepended on first message) |
| `sessionPrompts` | `Record<string, string>` | No | Per-session prompts (keyed by session ID or `__new__`) |
| `appliedSessionPrompts` | `Record<string, string>` | Yes | Sent prompts (for display in context panel) |
| `profession` | `string` | Yes | User's profession (injected into system prompt) |
| `selectedModel` | `string \| null` | Yes | Override model name (null = use backend default) |
| `effortMode` | `"low" \| "medium" \| "high"` | Yes | Default effort mode |
| `sessionEffortModes` | `Record<string, string>` | Yes | Per-session effort mode overrides |
| `uiTheme` | `"light" \| "dark"` | Yes | UI theme |
| `codeTheme` | `string` | Yes | Monaco / syntax highlight theme |
| `repoPath` | `string` | Yes | Default repo path for Code mode |
| `avatarVersion` | `number` | Yes | Incremented to bust avatar cache |

---

## Key Actions

### Session Actions
```typescript
setSessionId(id)
bumpSessionVersion()     // triggers sidebar session list refresh
bumpScrollToBottom()     // triggers ChatWindow auto-scroll
```

### Message Actions
```typescript
addSessionMessage(sessionId, message)
updateSessionMessage(sessionId, id, updater)
startStreaming(sessionId)    // adds to streamingSet
stopStreaming(sessionId)     // removes from streamingSet
isStreaming(sessionId)       // → boolean
```

### Plan Actions
```typescript
setChatPendingPlan(plan)
setChatPlanStatus(status)
updateChatPlanStepStatus(stepId, status)
clearChatPlan()
```

### Settings Actions
```typescript
setSystemPrompt(prompt)
setSessionPrompt(sessionId, prompt)
setProfession(profession)
setSelectedModel(model)
setEffortMode(mode)
setSessionEffortMode(sessionId, mode)
setUiTheme(theme)
setCodeTheme(theme)
```

---

## Message Type

```typescript
interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  thinking?: string          // CoT text from <think> blocks
  toolCalls?: ToolCallRecord[]
  attachments?: MessageAttachment[]
  skillPrefix?: string       // display label for skill slash-commands
  timestamp: Date
}
```

### ToolCallRecord

```typescript
interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error' | 'active'
  preview?: string           // truncated output shown in UI
}
```

---

## Persistence Notes

- `sessionMessages` is **not persisted** — messages are re-fetched from the API (`GET /api/chat/messages/{sessionId}`) when the user navigates to a session
- `streamingSet` is **not persisted** — a `streaming` flag on the backend `ChatSession` is the source of truth; the frontend checks it on page load to know whether to call `/api/chat/resume/{id}`
- The `avatarVersion` counter is incremented after avatar upload/delete; the frontend constructs the avatar URL with `?v=<version>` to bust the browser cache
