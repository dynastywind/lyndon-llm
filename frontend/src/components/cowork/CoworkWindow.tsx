import { useState } from 'react'
import { Play, CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { createPlan, executePlan } from '@/api/client'
import type { PlanStep, RiskLevel } from '@/types'

const RISK_BADGE: Record<RiskLevel, { label: string; className: string }> = {
  low:    { label: 'Low',    className: 'bg-green-500/20 text-green-400' },
  medium: { label: 'Medium', className: 'bg-yellow-500/20 text-yellow-400' },
  high:   { label: 'High',   className: 'bg-red-500/20 text-red-400' },
}

function StepCard({ step }: { step: PlanStep }) {
  const badge = RISK_BADGE[step.risk]
  const statusIcon = {
    pending:  null,
    running:  <Loader2 size={14} className="animate-spin text-blue-400" />,
    done:     <CheckCircle size={14} className="text-green-400" />,
    failed:   <XCircle size={14} className="text-red-400" />,
    skipped:  <AlertTriangle size={14} className="text-yellow-400" />,
  }[step.status ?? 'pending']

  return (
    <div className="flex gap-3 p-3 rounded-lg border border-border bg-card/50">
      <span className="text-muted-foreground text-sm font-mono w-5 shrink-0">{step.order}.</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{step.title}</span>
          {statusIcon}
          <span className={cn('ml-auto text-xs px-1.5 py-0.5 rounded', badge.className)}>
            {badge.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono">tool: {step.tool}</p>
      </div>
    </div>
  )
}

export function CoworkWindow() {
  const { sessionId, currentPlan, setPlan } = useAppStore()
  const [goal, setGoal] = useState('')
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)

  const handlePlan = async () => {
    if (!goal.trim()) return
    setLoading(true)
    try {
      const plan = await createPlan(goal, sessionId)
      setPlan(plan)
    } finally {
      setLoading(false)
    }
  }

  const handleExecute = async () => {
    if (!currentPlan) return
    setExecuting(true)
    try {
      await executePlan(currentPlan.plan_id, sessionId)
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div>
        <h2 className="text-base font-semibold">Cowork</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Describe a goal — I'll plan it out for your approval, then execute.
        </p>
      </div>

      {/* Goal input */}
      <div className="flex gap-2">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Set up a Next.js project with Tailwind and deploy it to Vercel"
          rows={2}
          className="flex-1 resize-none bg-input rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handlePlan}
          disabled={loading || !goal.trim()}
          className="px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : 'Plan'}
        </button>
      </div>

      {/* Plan display */}
      {currentPlan && (
        <div className="flex-1 overflow-y-auto space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              {currentPlan.steps.length} steps
            </p>
            <button
              onClick={handleExecute}
              disabled={executing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-40"
            >
              <Play size={13} />
              {executing ? 'Running…' : 'Approve & Run'}
            </button>
          </div>
          {currentPlan.steps.map((step) => (
            <StepCard key={step.step_id} step={step} />
          ))}
        </div>
      )}
    </div>
  )
}
