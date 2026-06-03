// ── Modes ─────────────────────────────────────────────────────────────────────
export type Mode = 'chat' | 'cowork' | 'code' | 'sandbox'

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
  type: string // MIME type, e.g. "image/png"
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

// ── Chat Planner ──────────────────────────────────────────────────────────────

export interface ChatPlanStep {
  step_id: string
  order: number
  title: string
  description: string
  tool: string
  tool_args: Record<string, unknown>
  risk: 'low' | 'medium' | 'high'
  depends_on: string[]
}

export interface ChatPlan {
  plan_id: string
  goal: string
  steps: ChatPlanStep[]
}

export type ChatPlanStatus = 'pending_confirm' | 'running' | 'done' | 'failed' | 'cancelled'

export type ChatPlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

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

// ── Sandbox ───────────────────────────────────────────────────────────────────
export interface SandboxLanguage {
  id: string
  label: string
  available: boolean
  runtime: 'docker' | 'process' | 'unavailable'
}

export interface SandboxResult {
  stdout: string
  stderr: string
  exit_code: number | null
  duration_ms: number
  timed_out: boolean
  runtime: 'docker' | 'process' | 'error'
}

// ── Memory ────────────────────────────────────────────────────────────────────
export type MemoryType = 'episodic' | 'semantic' | 'procedural'

export interface MemoryRecord {
  id: string
  content: string
  session_id: string
  memory_type: MemoryType
  importance: number
  created_at: string
}

export interface MemoriesResponse {
  memories: MemoryRecord[]
  total: number
}

// ── Metrics ───────────────────────────────────────────────────────────────────
export interface MetricRecord {
  id: string
  session_id: string | null
  created_at: string
  route: string | null
  total_ms: number
  phases: {
    route_ms?: number
    rag_ms?: number
    search_ms?: number
    ttft_ms?: number
    total_ms?: number
  }
}

export interface MetricsSummary {
  count: number
  avg_total_ms: number
  p50_total_ms: number | null
  p90_total_ms: number | null
  min_total_ms: number
  max_total_ms: number
  avg_ttft_ms: number | null
  p90_ttft_ms: number | null
}

export interface MetricsResponse {
  metrics: MetricRecord[]
  total: number
  summary: MetricsSummary
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
