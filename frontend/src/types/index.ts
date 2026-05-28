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
}
