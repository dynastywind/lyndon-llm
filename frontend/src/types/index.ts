// ── Modes ─────────────────────────────────────────────────────────────────────
export type Mode = 'chat' | 'cowork' | 'code'

// ── Chat ──────────────────────────────────────────────────────────────────────
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: Date
  toolName?: string
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
