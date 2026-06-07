import type {
  Plan,
  StepResult,
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
  Project,
  ProjectFile,
  ToolRegistry,
  McpServer,
  McpServerCreate,
  McpServerTool,
  Skill,
} from '@/types'
import { useAppStore } from '@/store'

// When the app runs inside Tauri (production desktop build) the frontend is
// served from the tauri:// custom protocol — there is no Vite proxy, so
// relative /api/* paths would resolve to tauri:///api/* (invalid).
// Detect Tauri at runtime and point directly at the local backend.
const IS_TAURI =
  typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'
const BASE = IS_TAURI ? 'http://localhost:8000/api' : '/api'

/** Attachment payload sent to the chat endpoint (base64 content, no prefix). */
export interface AttachmentPayload {
  name: string
  type: string // MIME type
  data: string // raw base64 (no "data:...;base64," prefix)
}

function authHeader(): Record<string, string> {
  const token = useAppStore.getState().user?.token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function headers(sessionId: string, mode: string) {
  return {
    'Content-Type': 'application/json',
    'x-session-id': sessionId,
    'x-mode': mode,
    'x-client': IS_TAURI ? 'desktop' : 'web',
    ...authHeader(),
  }
}

function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...authHeader() }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthResponse {
  access_token: string
  token_type: string
  username: string
  id: string
  email: string | null
}

/** Persistent device ID — generated once and stored in localStorage. */
function getDeviceId(): string {
  const KEY = 'lyndon-device-id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
  }
  return id
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, device_id: getDeviceId() }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function register(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, device_id: getDeviceId() }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function checkUsername(username: string): Promise<{ available: boolean }> {
  const res = await fetch(`${BASE}/auth/check-username?username=${encodeURIComponent(username)}`)
  if (!res.ok) throw new Error('Failed to check username')
  return res.json()
}

export async function getGoogleAuthUrl(): Promise<{ url: string }> {
  const res = await fetch(`${BASE}/auth/google/authorize`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function completeOAuthLogin(
  pendingToken: string,
  username: string,
): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/oauth/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_token: pendingToken, username }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

/** Returns the URL to display a user's avatar, with a cache-buster version param. */
export function getAvatarUrl(userId: string, version: number): string {
  return `${BASE}/auth/avatar/${userId}?v=${version}`
}

/** Returns true if the server has an avatar for the given user. */
export async function checkAvatarExists(userId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/avatar/${userId}`)
    return res.ok
  } catch {
    return false
  }
}

export async function uploadAvatar(dataUrl: string): Promise<void> {
  // Convert the base64 data URL produced by the canvas into a Blob for multipart upload
  const fetchRes = await fetch(dataUrl)
  const blob = await fetchRes.blob()
  const form = new FormData()
  form.append('file', blob, 'avatar.jpg')
  const res = await fetch(`${BASE}/auth/avatar`, {
    method: 'POST',
    headers: authHeader(), // no Content-Type — browser sets multipart boundary
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
}

export async function deleteAvatar(): Promise<void> {
  const res = await fetch(`${BASE}/auth/avatar`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (!res.ok) throw new Error('Failed to delete avatar')
}

export async function updateProfile(fields: {
  email?: string | null
  system_prompt?: string | null
  profession?: string | null
}): Promise<void> {
  const res = await fetch(`${BASE}/auth/me`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
}

/** Per-user profile + assistant settings, loaded from the server after login. */
export interface MeResponse {
  id: string
  username: string
  email: string | null
  profession: string | null
  system_prompt: string | null
}

export async function getMe(): Promise<MeResponse> {
  const res = await fetch(`${BASE}/auth/me`, { headers: jsonHeaders() })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function resetPassword(username: string, newPassword: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, new_password: newPassword }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch(`${BASE}/auth/me`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (!res.ok) throw new Error('Failed to delete account')
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
  model?: string,
  skillId?: string,
  skillPrefix?: string,
  effortMode?: 'low' | 'medium' | 'high',
  mode: string = 'chat',
  requireToolApproval: boolean = false,
  workingDirectory?: string,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${BASE}/chat/`, {
      method: 'POST',
      headers: headers(sessionId, mode),
      signal,
      body: JSON.stringify({
        message,
        ...(attachments?.length ? { attachments } : {}),
        ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
        ...(sessionPrompt ? { session_prompt: sessionPrompt } : {}),
        ...(model ? { model } : {}),
        ...(skillId ? { skill_id: skillId } : {}),
        ...(skillPrefix ? { skill_prefix: skillPrefix } : {}),
        ...(effortMode ? { effort_mode: effortMode } : {}),
        ...(requireToolApproval ? { require_tool_approval: true } : {}),
        ...(workingDirectory ? { working_directory: workingDirectory } : {}),
      }),
    })
  } catch (err) {
    // Aborted before headers arrived (user hit stop) — not a real error.
    if ((err as Error)?.name === 'AbortError') return
    throw err
  }
  if (!res.ok) throw new Error(`Chat error: ${res.statusText}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE messages are separated by \n\n
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? '' // last element may be incomplete

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
  } catch (err) {
    // Aborted mid-stream by the stop button — swallow so the caller ends cleanly.
    if ((err as Error)?.name === 'AbortError') return
    throw err
  } finally {
    try {
      await reader.cancel()
    } catch {
      // reader already released/closed
    }
  }
}

// ── Stream status / resume ────────────────────────────────────────────────────

/** Returns whether the backend has an active LLM task running for this session. */
export async function getStreamStatus(sessionId: string): Promise<{ streaming: boolean }> {
  const res = await fetch(`${BASE}/chat/sessions/${sessionId}/stream/status`, {
    headers: authHeader(),
  })
  if (!res.ok) return { streaming: false }
  return res.json()
}

/**
 * Re-attach to an in-progress LLM stream.
 * Replays all accumulated events from the beginning, then continues live.
 * Throws if no active stream exists (404).
 */
export async function resumeStream(
  sessionId: string,
  onEvent: (type: string, data: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${BASE}/chat/sessions/${sessionId}/stream/resume`, {
      headers: authHeader(),
      signal,
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return
    throw err
  }
  if (!res.ok) throw new Error(`Resume stream failed: ${res.statusText}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

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
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return
    throw err
  } finally {
    try {
      await reader.cancel()
    } catch {
      // reader already released/closed
    }
  }
}

/**
 * Ask the backend to stop the in-progress LLM task for this session.
 * Best-effort: the engine stops at its next streamed event and persists the
 * partial reply. Safe to call even if no stream is active.
 */
export async function cancelStream(sessionId: string): Promise<void> {
  try {
    await fetch(`${BASE}/chat/sessions/${sessionId}/stream/cancel`, {
      method: 'POST',
      headers: authHeader(),
    })
  } catch {
    // network hiccup — the client-side abort already stopped receiving
  }
}

// ── Chat planner ──────────────────────────────────────────────────────────────

export async function confirmChatPlan(
  planId: string,
  sessionId: string,
  onEvent: (type: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/chat/plan/confirm`, {
    method: 'POST',
    headers: headers(sessionId, 'chat'),
    body: JSON.stringify({ plan_id: planId }),
  })
  if (!res.ok) throw new Error(`Plan confirm error: ${res.statusText}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
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

export async function cancelChatPlan(planId: string, sessionId: string): Promise<void> {
  await fetch(`${BASE}/chat/plan/cancel`, {
    method: 'POST',
    headers: headers(sessionId, 'chat'),
    body: JSON.stringify({ plan_id: planId }),
  })
}

// ── Tool approval (ask-before-acting) ────────────────────────────────────────

export async function approveToolCall(sessionId: string, callId: string): Promise<void> {
  await fetch(`${BASE}/chat/tool/approve`, {
    method: 'POST',
    headers: headers(sessionId, 'chat'),
    body: JSON.stringify({ call_id: callId }),
  })
}

export async function rejectToolCall(sessionId: string, callId: string): Promise<void> {
  await fetch(`${BASE}/chat/tool/reject`, {
    method: 'POST',
    headers: headers(sessionId, 'chat'),
    body: JSON.stringify({ call_id: callId }),
  })
}

// ── Chat sessions ─────────────────────────────────────────────────────────────

export async function createChatSession(
  mode = 'chat',
  projectId: string | null = null,
): Promise<ChatSession> {
  const res = await fetch(`${BASE}/chat/sessions`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, project_id: projectId }),
  })
  if (!res.ok) throw new Error(`Failed to create session: ${res.statusText}`)
  return res.json()
}

export async function moveSessionToProject(
  sessionId: string,
  projectId: string | null,
): Promise<ChatSession> {
  const res = await fetch(`${BASE}/chat/sessions/${sessionId}/project`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify({ project_id: projectId }),
  })
  if (!res.ok) throw new Error(`Failed to move session: ${res.statusText}`)
  return res.json()
}

export async function getChatSession(
  sessionId: string,
): Promise<ChatSession & { project_name: string | null }> {
  const res = await fetch(`${BASE}/chat/sessions/${sessionId}`, { headers: authHeader() })
  if (!res.ok) throw new Error(`Failed to load session: ${res.statusText}`)
  return res.json()
}

export async function listChatSessions(
  mode = 'chat',
  limit = 20,
  offset = 0,
): Promise<ChatSessionsResponse> {
  const res = await fetch(`${BASE}/chat/sessions?mode=${mode}&limit=${limit}&offset=${offset}`, {
    headers: authHeader(),
  })
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.statusText}`)
  return res.json()
}

export async function searchChatSessions(
  mode = 'chat',
  q: string,
  limit = 20,
  offset = 0,
): Promise<{ sessions: (ChatSession & { snippet?: string })[]; total: number }> {
  const params = new URLSearchParams({ mode, q, limit: String(limit), offset: String(offset) })
  const res = await fetch(`${BASE}/chat/sessions/search?${params}`, {
    headers: authHeader(),
  })
  if (!res.ok) throw new Error(`Search failed: ${res.statusText}`)
  return res.json()
}

export async function getChatMessages(
  sessionId: string,
  limit = 5,
  before?: string, // ISO-8601 cursor — fetch messages older than this
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

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects(mode = 'chat'): Promise<{ projects: Project[] }> {
  const res = await fetch(`${BASE}/projects/?mode=${mode}`, { headers: authHeader() })
  if (!res.ok) throw new Error(`Failed to list projects: ${res.statusText}`)
  return res.json()
}

export async function searchProjects(mode = 'chat', q: string): Promise<{ projects: Project[] }> {
  const params = new URLSearchParams({ mode, q })
  const res = await fetch(`${BASE}/projects/search?${params}`, { headers: authHeader() })
  if (!res.ok) throw new Error(`Project search failed: ${res.statusText}`)
  return res.json()
}

export async function createProject(
  mode: string,
  name: string,
  instructions?: string,
): Promise<Project> {
  const res = await fetch(`${BASE}/projects/`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ mode, name, instructions: instructions ?? null }),
  })
  if (!res.ok) throw new Error(`Failed to create project: ${res.statusText}`)
  return res.json()
}

export async function getProject(id: string): Promise<Project> {
  const res = await fetch(`${BASE}/projects/${id}`, { headers: authHeader() })
  if (!res.ok) throw new Error(`Failed to load project: ${res.statusText}`)
  return res.json()
}

export async function updateProject(
  id: string,
  patch: { name?: string; instructions?: string; folders?: { path: string; name: string }[] },
): Promise<Project> {
  const res = await fetch(`${BASE}/projects/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`Failed to update project: ${res.statusText}`)
  return res.json()
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${BASE}/projects/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (!res.ok) throw new Error(`Failed to delete project: ${res.statusText}`)
}

export async function listProjectSessions(id: string): Promise<{ sessions: ChatSession[] }> {
  const res = await fetch(`${BASE}/projects/${id}/sessions`, { headers: authHeader() })
  if (!res.ok) throw new Error(`Failed to load project chats: ${res.statusText}`)
  return res.json()
}

export async function listProjectFiles(id: string): Promise<{ files: ProjectFile[] }> {
  const res = await fetch(`${BASE}/projects/${id}/files`, { headers: authHeader() })
  if (!res.ok) throw new Error(`Failed to load project files: ${res.statusText}`)
  return res.json()
}

export async function uploadProjectFile(
  id: string,
  file: File,
): Promise<{ filename: string; path: string; chunks_stored: number }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/projects/${id}/files`, {
    method: 'POST',
    body: form,
    headers: authHeader(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function deleteProjectFile(id: string, source: string): Promise<void> {
  const params = new URLSearchParams({ source })
  const res = await fetch(`${BASE}/projects/${id}/files?${params}`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (!res.ok) throw new Error(`Failed to delete file: ${res.statusText}`)
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
  const res = await fetch(`${BASE}/rag/upload`, {
    method: 'POST',
    body: form,
    headers: authHeader(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export interface RagSource {
  path: string
  name: string
  chunks: number
  size_bytes: number | null
}

export async function listRagSources(
  limit = 10,
  offset = 0,
  query = '',
): Promise<{ sources: RagSource[]; total: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (query) params.set('query', query)
  const res = await fetch(`${BASE}/rag/sources?${params}`, { headers: authHeader() })
  if (!res.ok) throw new Error(`Failed to list sources: ${res.statusText}`)
  return res.json()
}

export async function checkRagSourceName(
  name: string,
): Promise<{ exists: boolean; path: string | null }> {
  const res = await fetch(`${BASE}/rag/sources/check?name=${encodeURIComponent(name)}`, {
    headers: authHeader(),
  })
  if (!res.ok) throw new Error(`Failed to check source name: ${res.statusText}`)
  return res.json()
}

export async function reindexRagSource(
  source: string,
): Promise<{ path: string; chunks_stored: number }> {
  const res = await fetch(`${BASE}/rag/reindex?source=${encodeURIComponent(source)}`, {
    method: 'POST',
    headers: authHeader(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export async function deleteRagSource(source: string, deleteFile = true): Promise<void> {
  const params = new URLSearchParams({ source, delete_file: String(deleteFile) })
  const res = await fetch(`${BASE}/rag/sources?${params}`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (!res.ok) throw new Error(`Failed to delete source: ${res.statusText}`)
}

// Set asBinary for files served as raw bytes (PDF, images) — returns an object
// URL for a Blob. For text/code files it returns the decoded text content.
export async function fetchRagSourceContent(source: string, asBinary: boolean): Promise<string> {
  const res = await fetch(`${BASE}/rag/sources/content?source=${encodeURIComponent(source)}`, {
    headers: authHeader(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? res.statusText)
  }
  if (asBinary) {
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  }
  const data = (await res.json()) as { content: string; ext: string }
  return data.content
}

// ── Tool registry (MCP + internal) ───────────────────────────────────────────

export async function getToolRegistry(): Promise<ToolRegistry> {
  const res = await fetch(`${BASE}/registry`, { headers: authHeader() })
  if (!res.ok) throw new Error(`Failed to load tool registry: ${res.statusText}`)
  return res.json()
}

export async function createMcpServer(body: McpServerCreate): Promise<McpServer> {
  const res = await fetch(`${BASE}/registry/mcp/servers`, {
    method: 'POST',
    headers: jsonHeaders(),
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
    headers: jsonHeaders(),
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
    headers: authHeader(),
  })
  if (!res.ok) throw new Error(`Failed to delete MCP server: ${res.statusText}`)
}

export async function refreshMcpServer(serverId: string): Promise<McpServer> {
  const res = await fetch(`${BASE}/registry/mcp/servers/${serverId}/refresh`, {
    method: 'POST',
    headers: authHeader(),
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
      headers: jsonHeaders(),
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

export async function executePlan(
  planId: string,
  sessionId: string,
): Promise<{ results: StepResult[] }> {
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

export async function commitFiles(files: string[], message: string, sessionId: string) {
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
  const res = await fetch(`${BASE}/chat/memories`, { headers: authHeader() })
  if (!res.ok) throw new Error('Failed to fetch memories')
  return res.json()
}

export async function deleteMemory(memoryId: string): Promise<void> {
  const res = await fetch(`${BASE}/chat/memories/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (!res.ok) throw new Error('Failed to delete memory')
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export async function getMetrics(
  params: { limit?: number; offset?: number; session_id?: string } = {},
): Promise<MetricsResponse> {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set('limit', String(params.limit))
  if (params.offset !== undefined) qs.set('offset', String(params.offset))
  if (params.session_id) qs.set('session_id', params.session_id)
  const res = await fetch(`${BASE}/metrics?${qs}`)
  if (!res.ok) throw new Error('Failed to fetch metrics')
  return res.json()
}

// ── Models ────────────────────────────────────────────────────────────────────

export async function getModels(): Promise<{ models: string[] }> {
  const res = await fetch(`${BASE.replace('/api', '')}/api/models`)
  if (!res.ok) throw new Error('Failed to fetch models')
  return res.json()
}

// ── Skills ────────────────────────────────────────────────────────────────────

export async function getSkills(): Promise<Skill[]> {
  const res = await fetch(`${BASE}/skills`, { headers: authHeader() })
  if (!res.ok) throw new Error('Failed to fetch skills')
  return res.json()
}

export async function uploadSkill(formData: FormData): Promise<Skill> {
  const res = await fetch(`${BASE}/skills/upload`, {
    method: 'POST',
    headers: authHeader(),
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(err.detail ?? 'Upload failed')
  }
  return res.json()
}

export async function toggleSkill(id: string, enabled: boolean): Promise<Skill> {
  const res = await fetch(`${BASE}/skills/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!res.ok) throw new Error('Failed to toggle skill')
  return res.json()
}

export async function deleteSkill(id: string): Promise<void> {
  const res = await fetch(`${BASE}/skills/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (!res.ok) throw new Error('Failed to delete skill')
}
