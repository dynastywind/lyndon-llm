# API Client

**Path**: `frontend/src/api/client.ts`
**Purpose**: All REST calls and SSE streaming to the backend. Single file, ~800 lines.

---

## Base URL Resolution

```typescript
const IS_TAURI = Boolean((window as any).__TAURI_INTERNALS__)
export const BASE = IS_TAURI ? 'http://localhost:8000/api' : '/api'
```

In Vite dev mode, `/api` is proxied to `http://localhost:8000` by `vite.config.ts`. In a Tauri production build, the full URL is used (no proxy).

---

## Auth and Session Headers

Every authenticated request includes:

```typescript
function authHeader(): Record<string, string> {
  const token = useAppStore.getState().user?.token
  return token ? { Authorization: `Bearer ${token}` } : {}
}
```

Chat/cowork/code requests also send:

| Header | Value |
|---|---|
| `x-session-id` | Current session UUID |
| `x-mode` | `"chat"` / `"cowork"` / `"code"` |

---

## Endpoint Groups

### Auth

| Function | Method | Path | Description |
|---|---|---|---|
| `login(username, password)` | POST | `/auth/login` | → `{ token, user }` |
| `register(username, password)` | POST | `/auth/register` | → `{ token, user }` |
| `refreshToken()` | POST | `/auth/refresh` | → new JWT |
| `googleAuthorize()` | GET | `/auth/google/authorize` | Redirect URL for OAuth |
| `completeOAuth(username, pendingToken)` | POST | `/auth/oauth/complete` | → `{ token, user }` |
| `resetPassword(oldPw, newPw)` | POST | `/auth/reset-password` | |
| `deleteAccount()` | DELETE | `/auth/account` | |
| `uploadAvatar(file)` | POST | `/auth/avatar` | Multipart upload |
| `deleteAvatar()` | DELETE | `/auth/avatar` | |
| `checkAvatar()` | GET | `/auth/avatar/check` | → `{ exists: bool }` |
| `getLoginHistory()` | GET | `/auth/login-history` | → `LoginRecord[]` |

### Sessions

| Function | Method | Path | Description |
|---|---|---|---|
| `createChatSession(mode)` | POST | `/chat/sessions` | → `{ session_id }` |
| `getSessions(mode)` | GET | `/chat/sessions?mode=…` | → `ChatSession[]` |
| `getSession(id)` | GET | `/chat/sessions/{id}` | → `ChatSession` |
| `deleteSession(id)` | DELETE | `/chat/sessions/{id}` | |
| `searchSessions(query, mode)` | GET | `/chat/search?q=…` | → `SearchResult[]` |

### Messages

| Function | Method | Path | Description |
|---|---|---|---|
| `getMessages(sessionId, beforeId?, limit?)` | GET | `/chat/messages/{id}` | Paginated history |

### Chat Streaming

| Function | Description |
|---|---|
| `streamChat(message, sessionId, callback, …)` | POST `/chat/` → SSE, calls `callback(type, data)` per event |
| `resumeStream(sessionId, callback)` | GET `/chat/resume/{id}` → replay buffer then live stream |

### Plan Management

| Function | Method | Path | Description |
|---|---|---|---|
| `confirmPlan(planId, callback)` | POST | `/chat/plan/{id}/confirm` | Execute plan, SSE stream |
| `cancelPlan(planId)` | DELETE | `/chat/plan/{id}` | Cancel pending plan |

### RAG

| Function | Method | Path | Description |
|---|---|---|---|
| `ingestDocument(file)` | POST | `/rag/ingest` | Upload + ingest document |
| `getSources()` | GET | `/rag/sources` | → `string[]` |
| `checkSourceName(name)` | GET | `/rag/sources?check=…` | |
| `getSourceContent(source)` | GET | `/rag/content/{source}` | → text or PDF bytes |
| `reindexSource(source)` | POST | `/rag/reindex` | Re-embed document |
| `deleteSource(source)` | DELETE | `/rag/sources/{source}` | |

### Sandbox

| Function | Method | Path | Description |
|---|---|---|---|
| `getLanguages()` | GET | `/sandbox/languages` | → `Language[]` with `available`, `runtime` |
| `runCode(language, code, timeout?)` | POST | `/sandbox/run` | → `{ stdout, stderr, exit_code, … }` |

### Registry / MCP

| Function | Method | Path | Description |
|---|---|---|---|
| `getInternalTools(mode)` | GET | `/registry/tools?mode=…` | Built-in tool metadata |
| `getMcpServers()` | GET | `/registry/mcp` | All MCP servers + tools |
| `addMcpServer(config)` | POST | `/registry/mcp` | Register new server |
| `deleteMcpServer(id)` | DELETE | `/registry/mcp/{id}` | |
| `refreshMcpServer(id)` | POST | `/registry/mcp/{id}/refresh` | Re-discover tools |
| `toggleMcpTool(serverId, toolName, enabled)` | PATCH | `/registry/mcp/{id}/tools/{name}` | |

### Skills

| Function | Method | Path | Description |
|---|---|---|---|
| `getSkills()` | GET | `/skills/` | → `Skill[]` |
| `uploadSkill(file)` | POST | `/skills/upload` | Upload ZIP |
| `toggleSkill(id, enabled)` | PATCH | `/skills/{id}/toggle` | |
| `deleteSkill(id)` | DELETE | `/skills/{id}` | |

### Memory

| Function | Method | Path | Description |
|---|---|---|---|
| `getMemory(sessionId?)` | GET | `/memory` | Session or cross-session memory |
| `deleteMemory(sessionId?)` | DELETE | `/memory` | Clear memory |

### Metrics

| Function | Method | Path | Description |
|---|---|---|---|
| `getMetrics(limit?, offset?, sessionId?)` | GET | `/metrics` | Request performance metrics |

### Models

| Function | Method | Path | Description |
|---|---|---|---|
| `getModels()` | GET | `/models` | → `string[]` (loaded LLM models) |

---

## SSE Parser

Both `streamChat` and `resumeStream` use the same SSE parsing loop:

```typescript
const reader = response.body!.getReader()
const decoder = new TextDecoder()
let buffer = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split('\n')
  buffer = lines.pop()!   // keep incomplete last line

  let eventType = ''
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim()
    } else if (line.startsWith('data: ') && eventType) {
      const data = JSON.parse(line.slice(6))
      callback(eventType, data)
      eventType = ''
    }
  }
}
```

The parser is stateful (carries `eventType` across lines) to handle multi-line `event:` / `data:` pairs correctly.

---

## Error Handling

All fetch wrappers throw on non-2xx responses:

```typescript
if (!response.ok) {
  const body = await response.json().catch(() => ({}))
  throw new Error(body.detail ?? `HTTP ${response.status}`)
}
```

Callers (hooks and components) catch errors and display them via toast or inline error state.

---

## Attachment Payload

Files attached to chat messages are encoded as Base64 before sending:

```typescript
interface AttachmentPayload {
  name: string    // filename
  type: string    // MIME type
  data: string    // Base64 string (no data: prefix)
}
```

The `data` field strips the `data:<mime>;base64,` prefix — only the raw Base64 string is sent. The backend decodes it.
