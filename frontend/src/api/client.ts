import type {
  Plan,
  FileDiff,
  ReviewResult,
  TestResult,
  MetricsResponse,
  MemoriesResponse,
  SandboxLanguage,
  SandboxResult,
  ChatSession,
  ChatSessionsResponse,
  ChatSessionMessage,
  ToolRegistry,
  McpServer,
  McpServerCreate,
  McpServerTool,
} from '@/types'

const BASE = '/api'

/** Attachment payload sent to the chat endpoint (base64 content, no prefix). */
export interface AttachmentPayload {
  name: string
  type: string  // MIME type
  data: string  // raw base64 (no "data:...;base64," prefix)
}

function headers(sessionId: string, mode: string) {
  return {
    'Content-Type': 'application/json',
    'x-session-id': sessionId,
    'x-mode': mode,
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────

/**
 * Stream a chat message and receive typed SSE events.
 *
 * Event types emitted by the backend:
 *   token       — { text: string }           LLM token to append
 *   tool_start  — { id, name, args }         model requested a tool call
 *   tool_result — { id, name, success, preview } tool finished
 *   error       — { message: string }        non-fatal error
 *   done        — {}                         stream complete
 */
export async function streamChat(
  message: string,
  sessionId: string,
  onEvent: (type: string, data: Record<string, unknown>) => void,
  attachments?: AttachmentPayload[],
  systemPrompt?: string,
  sessionPrompt?: string,
): Promise<void> {
  const res = await fetch(`${BASE}/chat/`, {
    method: 'POST',
    headers: headers(sessionId, 'chat'),
    body: JSON.stringify({
      message,
      ...(attachments?.length ? { attachments } : {}),
      ...(systemPrompt         ? { system_prompt:   systemPrompt  } : {}),
      ...(sessionPrompt        ? { session_prompt:  sessionPrompt } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Chat error: ${res.statusText}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // SSE messages are separated by \n\n
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''          // last element may be incomplete

    for (const part of parts) {
      if (!part.trim()) continue
      let eventType = 'message'
      let dataStr = ''

      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim()
        else if (line.startsWith('data: ')) dataStr = line.slice(6)
      }

      if (dataStr) {
        try {
          onEvent(eventType, JSON.parse(dataStr))
        } catch {
          // malformed JSON — skip
        }
      }
    }
  }
}

// ── Chat sessions ─────────────────────────────────────────────────────────────

export async function createChatSession(): Promise<ChatSession> {
  const res = await fetch(`${BASE}/chat/sessions`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to create session: ${res.statusText}`)
  return res.json()
}

export async function listChatSessions(
  mode = 'chat',
  limit = 20,
  offset = 0,
): Promise<ChatSessionsResponse> {
  const res = await fetch(
    `${BASE}/chat/sessions?mode=${mode}&limit=${limit}&offset=${offset}`,
  )
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.statusText}`)
  return res.json()
}

export async function getChatMessages(
  sessionId: string,
  limit = 5,
  before?: string,          // ISO-8601 cursor — fetch messages older than this
): Promise<{ messages: ChatSessionMessage[]; has_more: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', before)
  const res = await fetch(`${BASE}/chat/sessions/${sessionId}/messages?${params}`)
  if (!res.ok) throw new Error(`Failed to load messages: ${res.statusText}`)
  return res.json()
}

export async function getAllChatMessages(
  sessionId: string,
): Promise<{ messages: ChatSessionMessage[] }> {
  const res = await fetch(`${BASE}/chat/sessions/${sessionId}/messages/all`)
  if (!res.ok) throw new Error(`Failed to load messages: ${res.statusText}`)
  return res.json()
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await fetch(`${BASE}/chat/sessions/${sessionId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to delete session: ${res.statusText}`)
}

export async function renameChatSession(sessionId: string, title: string): Promise<ChatSession> {
  const res = await fetch(`${BASE}/chat/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`Failed to rename session: ${res.statusText}`)
  return res.json()
}

export async function ingestDocument(source: string): Promise<{ chunks_stored: number }> {
  const res = await fetch(`${BASE}/chat/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  return res.json()
}

// ── RAG management ────────────────────────────────────────────────────────────

export async function uploadRagFile(
  file: File,
): Promise<{ filename: string; path: string; chunks_stored: number }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/rag/upload`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function listRagSources(): Promise<{ sources: string[] }> {
  const res = await fetch(`${BASE}/rag/sources`)
  if (!res.ok) throw new Error(`Failed to list sources: ${res.statusText}`)
  return res.json()
}

export async function deleteRagSource(source: string): Promise<void> {
  const res = await fetch(
    `${BASE}/rag/sources?source=${encodeURIComponent(source)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(`Failed to delete source: ${res.statusText}`)
}

// ── Tool registry (MCP + internal) ───────────────────────────────────────────

export async function getToolRegistry(): Promise<ToolRegistry> {
  const res = await fetch(`${BASE}/registry`)
  if (!res.ok) throw new Error(`Failed to load tool registry: ${res.statusText}`)
  return res.json()
}

export async function createMcpServer(body: McpServerCreate): Promise<McpServer> {
  const res = await fetch(`${BASE}/registry/mcp/servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function updateMcpServer(
  serverId: string,
  body: Partial<McpServerCreate>,
): Promise<McpServer> {
  const res = await fetch(`${BASE}/registry/mcp/servers/${serverId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function deleteMcpServer(serverId: string): Promise<void> {
  const res = await fetch(`${BASE}/registry/mcp/servers/${serverId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Failed to delete MCP server: ${res.statusText}`)
}

export async function refreshMcpServer(serverId: string): Promise<McpServer> {
  const res = await fetch(`${BASE}/registry/mcp/servers/${serverId}/refresh`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function toggleMcpTool(
  serverId: string,
  qualifiedName: string,
  enabled: boolean,
): Promise<McpServerTool> {
  const res = await fetch(
    `${BASE}/registry/mcp/servers/${serverId}/tools/${encodeURIComponent(qualifiedName)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  )
  if (!res.ok) throw new Error(`Failed to update tool: ${res.statusText}`)
  return res.json()
}

// ── Cowork ────────────────────────────────────────────────────────────────────
export async function createPlan(goal: string, sessionId: string): Promise<Plan> {
  const res = await fetch(`${BASE}/cowork/plan`, {
    method: 'POST',
    headers: headers(sessionId, 'cowork'),
    body: JSON.stringify({ goal }),
  })
  if (!res.ok) throw new Error(`Plan error: ${res.statusText}`)
  return res.json()
}

export async function executePlan(planId: string, sessionId: string) {
  const res = await fetch(`${BASE}/cowork/execute`, {
    method: 'POST',
    headers: headers(sessionId, 'cowork'),
    body: JSON.stringify({ plan_id: planId }),
  })
  if (!res.ok) throw new Error(`Execute error: ${res.statusText}`)
  return res.json()
}

// ── Code ──────────────────────────────────────────────────────────────────────
export async function editFile(
  filePath: string,
  instruction: string,
  sessionId: string,
  contextFiles: string[] = [],
): Promise<FileDiff> {
  const res = await fetch(`${BASE}/code/edit`, {
    method: 'POST',
    headers: headers(sessionId, 'code'),
    body: JSON.stringify({ file_path: filePath, instruction, context_files: contextFiles }),
  })
  return res.json()
}

export async function reviewDiff(diff: string, sessionId: string): Promise<ReviewResult> {
  const res = await fetch(`${BASE}/code/review`, {
    method: 'POST',
    headers: headers(sessionId, 'code'),
    body: JSON.stringify({ diff }),
  })
  return res.json()
}

export async function runTests(sessionId: string, testPath?: string): Promise<TestResult> {
  const res = await fetch(`${BASE}/code/test`, {
    method: 'POST',
    headers: headers(sessionId, 'code'),
    body: JSON.stringify({ test_path: testPath }),
  })
  return res.json()
}

export async function commitFiles(
  files: string[],
  message: string,
  sessionId: string,
) {
  const res = await fetch(`${BASE}/code/commit`, {
    method: 'POST',
    headers: headers(sessionId, 'code'),
    body: JSON.stringify({ files, message }),
  })
  return res.json()
}

// ── Sandbox ───────────────────────────────────────────────────────────────────

export async function getSandboxLanguages(): Promise<{ languages: SandboxLanguage[] }> {
  const res = await fetch(`${BASE}/sandbox/languages`)
  if (!res.ok) throw new Error('Failed to fetch languages')
  return res.json()
}

export async function runSandbox(
  language: string,
  code: string,
  timeout = 10,
): Promise<SandboxResult> {
  const res = await fetch(`${BASE}/sandbox/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language, code, timeout }),
  })
  if (!res.ok) throw new Error(`Sandbox error: ${res.statusText}`)
  return res.json()
}

// ── Memory ────────────────────────────────────────────────────────────────────

export async function getMemories(): Promise<MemoriesResponse> {
  const res = await fetch(`${BASE}/chat/memories`)
  if (!res.ok) throw new Error('Failed to fetch memories')
  return res.json()
}

export async function deleteMemory(memoryId: string): Promise<void> {
  const res = await fetch(`${BASE}/chat/memories/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete memory')
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export async function getMetrics(
  params: { limit?: number; offset?: number; session_id?: string } = {},
): Promise<MetricsResponse> {
  const qs = new URLSearchParams()
  if (params.limit    !== undefined) qs.set('limit',      String(params.limit))
  if (params.offset   !== undefined) qs.set('offset',     String(params.offset))
  if (params.session_id)             qs.set('session_id', params.session_id)
  const res = await fetch(`${BASE}/metrics?${qs}`)
  if (!res.ok) throw new Error('Failed to fetch metrics')
  return res.json()
}
