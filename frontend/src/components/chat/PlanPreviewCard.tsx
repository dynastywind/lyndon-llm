import { useAppStore } from '@/store'
import { usePlanExecution } from '@/hooks/usePlanExecution'
import type { ChatPlanStep, ChatPlanStepStatus } from '@/types'

const TOOL_LABEL: Record<string, string> = {
  web_search: 'web search',
  rag_query: 'knowledge base',
  render_chart: 'chart',
  run_code: 'code',
}

const STATUS_ICON: Record<ChatPlanStepStatus, string> = {
  pending: '○',
  running: '◌',
  done: '●',
  failed: '✕',
  skipped: '–',
}

const STATUS_COLOR: Record<ChatPlanStepStatus, string> = {
  pending: 'var(--lv-mute)',
  running: 'var(--lv-gold)',
  done: 'var(--lv-ink)',
  failed: '#e05c5c',
  skipped: 'var(--lv-mute)',
}

function StepRow({
  step,
  status = 'pending',
}: {
  step: ChatPlanStep
  status?: ChatPlanStepStatus
}) {
  const icon = STATUS_ICON[status]
  const color = STATUS_COLOR[status]
  const toolLabel = TOOL_LABEL[step.tool] ?? step.tool

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '6px 0',
        borderBottom: '1px solid var(--lv-rule)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color,
          flexShrink: 0,
          marginTop: 1,
          width: 14,
          textAlign: 'center',
          transition: 'color 0.2s',
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, color: 'var(--lv-ink)', lineHeight: '1.4' }}>
          {step.title}
        </span>
        <span
          style={{
            marginLeft: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--lv-mute)',
            letterSpacing: '0.05em',
          }}
        >
          {toolLabel}
        </span>
      </div>
    </div>
  )
}

export function PlanPreviewCard() {
  const { chatPendingPlan, chatPlanStatus, chatPlanStepStatuses } = useAppStore()
  const { confirm, cancel } = usePlanExecution()

  if (!chatPendingPlan) return null

  const isPendingConfirm = chatPlanStatus === 'pending_confirm'
  const isDone = chatPlanStatus === 'done'
  const isFailed = chatPlanStatus === 'failed'

  return (
    <div
      style={{
        margin: '0 240px 16px',
        border: '1px solid var(--lv-rule)',
        background: 'rgba(var(--lv-wash-rgb),0.02)',
        padding: '16px 20px',
      }}
    >
      {/* Header */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: isDone
            ? 'var(--lv-mute)'
            : isFailed
              ? '#e05c5c'
              : 'var(--lv-gold)',
          marginBottom: 10,
        }}
      >
        Plan · {chatPendingPlan.steps.length} step{chatPendingPlan.steps.length !== 1 ? 's' : ''}
        {isDone && '  · done'}
        {isFailed && '  · failed'}
      </div>

      {/* Goal */}
      <p
        style={{
          fontSize: 13,
          color: 'var(--lv-soft)',
          marginBottom: 14,
          lineHeight: '1.5',
        }}
      >
        {chatPendingPlan.goal}
      </p>

      {/* Steps */}
      <div style={{ marginBottom: isPendingConfirm ? 16 : 0 }}>
        {chatPendingPlan.steps.map((step) => (
          <StepRow
            key={step.step_id}
            step={step}
            status={chatPlanStepStatuses[step.step_id] ?? 'pending'}
          />
        ))}
      </div>

      {/* Action row — only shown while awaiting user confirmation */}
      {isPendingConfirm && (
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            type="button"
            onClick={confirm}
            style={{
              background: 'var(--lv-gold)',
              color: 'var(--lv-bg)',
              border: 'none',
              padding: '6px 16px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Run Plan
          </button>
          <button
            type="button"
            onClick={cancel}
            style={{
              background: 'none',
              color: 'var(--lv-mute)',
              border: '1px solid var(--lv-rule)',
              padding: '6px 16px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
