import type { Plan, FileDiff, ReviewResult, TestResult, ChatSession, ChatSessionsResponse, ChatSessionMessage } from '@/types'

const BASE = '/api'

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
): Promise<void> {
  const res = await fetch(`${BASE}/chat/`, {
    method: 'POST',
    headers: headers(sessionId, 'chat'),
    body: JSON.stringify({ message }),
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
