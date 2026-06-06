# Frontend Hooks

**Path**: `frontend/src/hooks/`
**Purpose**: Custom React hooks encapsulating API calls and complex UI state logic.

---

## useStream

**File**: `hooks/useStream.ts`

The core streaming hook. Returns `{ send, resume }`.

See [streaming.md](streaming.md) for the full SSE event contract and implementation details.

| Export | Description |
|---|---|
| `send(message, attachments?, skillId?, displayContent?, skillPrefix?)` | Send a chat message; handles session creation, system prompt injection, SSE streaming |
| `resume(sessionId)` | Re-attach to an in-progress backend stream after page refresh |

---

## useChatHistory

**File**: `hooks/useChatHistory.ts`

Manages the session list shown in the sidebar. Handles pagination and real-time updates.

```typescript
const {
  sessions,          // Session[] — currently loaded sessions
  hasMore,           // boolean — more pages available
  loadMore,          // () => void — load next page
  removeSession,     // (id: string) => void — optimistic delete
  isLoading,
} = useChatHistory(mode)
```

### Pagination

- Initial load: `INITIAL_LIMIT = 20` sessions
- Each `loadMore()` fetch: `MORE_LIMIT = 5` sessions
- Uses cursor-based pagination (`before_id` parameter) to avoid OFFSET on large tables

### Infinite Scroll

An `IntersectionObserver` sentinel element at the bottom of the session list triggers `loadMore()` automatically when it enters the viewport.

### Optimistic Delete

`removeSession(id)` removes the session from the local list immediately, then calls `deleteSession(id)` in the background. On API error, the session is restored.

### Live Updates

The hook listens to `sessionListVersion` from the Zustand store. `useStream.send()` calls `bumpSessionVersion()` after each completed stream, which re-fetches the session list to reflect updated session titles and `updated_at` timestamps.

---

## usePlanExecution

**File**: `hooks/usePlanExecution.ts`

Manages the chat plan confirmation and execution lifecycle for `PlanPreviewCard`.

```typescript
const {
  confirm,   // (planId: string) => void — approve plan, start execution SSE
  cancel,    // (planId: string) => void — cancel pending plan
  isRunning, // boolean
} = usePlanExecution()
```

### `confirm(planId)`

```
1. setChatPlanStatus('executing')
2. POST /api/chat/plan/{planId}/confirm → SSE stream
3. For each event:
   plan_step_started → updateChatPlanStepStatus(stepId, 'running')
   plan_step_done    → updateChatPlanStepStatus(stepId, 'done')
   plan_step_failed  → updateChatPlanStepStatus(stepId, 'failed')
   plan_done         → setChatPlanStatus('done')
4. On error: setChatPlanStatus('error')
```

Step statuses drive the `PlanPreviewCard` step badge colours (grey → blue spinner → green/red).

### `cancel(planId)`

```
DELETE /api/chat/plan/{planId}
clearChatPlan()   ← clears plan state from store
```
