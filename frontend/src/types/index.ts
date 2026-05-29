// ── Modes ─────────────────────────────────────────────────────────────────────
export type Mode = 'chat' | 'cowork' | 'code'

// ── Chat ──────────────────────────────────────────────────────────────────────

// ── Charts ────────────────────────────────────────────────────────────────────

export interface ChartSeries {
  key: string
  name?: string
  color?: string
}

export interface ChartSpec {
  type: 'bar' | 'line' | 'area' | 'pie'
  title: string
  x_key: string
  data: Record<string, unknown>[]
  series: ChartSeries[]
}

export interface ToolCallRecord {
  /** Matches the tool_call_id from the OpenAI response. */
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  /** First 200 chars of the tool result, shown as a tooltip hint. */
  preview?: string
}

/** A file or image attached to a user message. */
export interface MessageAttachment {
  name: string
  type: string    // MIME type, e.g. "image/png"
  dataUrl: string // full data URL: "data:<type>;base64,<data>"
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: Date
  toolName?: string
  /** Populated during streaming when the model invokes tools. */
  toolCalls?: ToolCallRecord[]
  /** Charts emitted by render_chart tool calls. */
  charts?: ChartSpec[]
  /** Files / images the user attached to this message. */
  attachments?: MessageAttachment[]
}

// ── Cowork ────────────────────────────────────────────────────────────────────
export type RiskLevel = 'low' | 'medium' | 'high'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface PlanStep {
  step_id: string
  order: number
  title: string
  description: string
  tool: string
  tool_args: Record<string, unknown>
  risk: RiskLevel
  depends_on: string[]
  status?: StepStatus
}

export interface Plan {
  plan_id: string
  goal: string
  steps: PlanStep[]
  approved: boolean
  display: string
}

// ── Code ──────────────────────────────────────────────────────────────────────
export interface FileDiff {
  file_path: string
  diff: string
  is_new: boolean
}

export interface ReviewComment {
  file_path: string
  line: number | null
  severity: 'info' | 'warning' | 'error'
  message: string
}

export interface ReviewResult {
  summary: string
  approved: boolean
  comments: ReviewComment[]
}

export interface TestResult {
  success: boolean
  passed: number
  failed: number
  errors: number
  failures: string[]
  output: string
}

// ── Session ───────────────────────────────────────────────────────────────────
export interface SessionState {
  sessionId: string
  mode: Mode
}

// ── Chat History ──────────────────────────────────────────────────────────────
export interface ChatSession {
  session_id: string
  mode: string
  title: string | null
  created_at: string
  updated_at: string
}

export interface ChatSessionsResponse {
  sessions: ChatSession[]
  total: number
}

export interface ChatSessionMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_name: string | null
  created_at: string
  /** Raw attachment payloads as stored in the DB (base64 data, no prefix). */
  attachments: Array<{ name: string; type: string; data: string }>
}

// ── Tool registry (Settings) ──────────────────────────────────────────────────

export interface RegistryTool {
  name: string
  description: string
  permission: string | null
  mode: string | null
  source: 'internal' | 'mcp'
  editable: boolean
  server_id?: string | null
  server_name?: string | null
  mcp_name?: string | null
  enabled?: boolean | null
}

export interface McpServerTool {
  qualified_name: string
  mcp_name: string
  description: string
  enabled: boolean
}

export interface McpServer {
  id: string
  name: string
  description: string | null
  transport: 'stdio' | 'sse' | string
  command: string | null
  args: string[]
  env: Record<string, string>
  url: string | null
  enabled: boolean
  last_error: string | null
  tools: McpServerTool[]
}

export interface ToolRegistry {
  internal_tools: RegistryTool[]
  mcp_servers: McpServer[]
}

export interface McpServerCreate {
  name: string
  description?: string | null
  transport: 'stdio' | 'sse'
  command?: string | null
  args?: string[]
  env?: Record<string, string>
  url?: string | null
  enabled?: boolean
}
