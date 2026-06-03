import { useCallback } from 'react'
import { confirmChatPlan, cancelChatPlan } from '@/api/client'
import { useAppStore } from '@/store'
import { generateId } from '@/lib/utils'
import type { ChatPlanStepStatus } from '@/types'

export function usePlanExecution() {
  const {
    sessionId,
    chatPendingPlan,
    setChatPlanStatus,
    updateChatPlanStepStatus,
    clearChatPlan,
    startStreaming,
    stopStreaming,
    bumpScrollToBottom,
    bumpSessionVersion,
  } = useAppStore()

  const confirm = useCallback(async () => {
    if (!chatPendingPlan || !sessionId) return

    setChatPlanStatus('running')
    startStreaming(sessionId)

    // Create an empty assistant bubble that synthesis tokens will fill
    const msgId = generateId()
    useAppStore.setState((s) => ({
      sessionMessages: {
        ...s.sessionMessages,
        [sessionId]: [
          ...(s.sessionMessages[sessionId] ?? []),
          {
            id: msgId,
            role: 'assistant' as const,
            content: '',
            timestamp: new Date(),
            toolCalls: [],
          },
        ],
      },
    }))

    const updateMsg = (updater: (prev: string) => string) => {
      useAppStore.setState((s) => {
        const msgs = [...(s.sessionMessages[sessionId] ?? [])]
        const idx = msgs.findIndex((m) => m.id === msgId)
        if (idx < 0) return s
        msgs[idx] = { ...msgs[idx], content: updater(msgs[idx].content) }
        return { sessionMessages: { ...s.sessionMessages, [sessionId]: msgs } }
      })
    }

    try {
      await confirmChatPlan(chatPendingPlan.plan_id, sessionId, (type, data) => {
        switch (type) {
          case 'plan_step_started':
            updateChatPlanStepStatus(data.step_id as string, 'running' as ChatPlanStepStatus)
            break
          case 'plan_step_done':
            updateChatPlanStepStatus(data.step_id as string, 'done' as ChatPlanStepStatus)
            break
          case 'plan_step_failed':
            updateChatPlanStepStatus(data.step_id as string, 'failed' as ChatPlanStepStatus)
            break
          case 'plan_done':
            setChatPlanStatus('done')
            break
          case 'token':
            updateMsg((prev) => prev + (data.text as string))
            bumpScrollToBottom()
            break
          case 'error':
            console.warn('[plan] backend error:', data.message)
            break
        }
      })
    } catch (err) {
      console.error('[plan] execution error:', err)
      setChatPlanStatus('failed')
    } finally {
      stopStreaming(sessionId)
      bumpScrollToBottom()
      bumpSessionVersion()
    }
  }, [
    chatPendingPlan,
    sessionId,
    setChatPlanStatus,
    updateChatPlanStepStatus,
    startStreaming,
    stopStreaming,
    bumpScrollToBottom,
    bumpSessionVersion,
  ])

  const cancel = useCallback(async () => {
    if (!chatPendingPlan || !sessionId) return
    try {
      await cancelChatPlan(chatPendingPlan.plan_id, sessionId)
    } catch {
      // best-effort cancel
    }
    clearChatPlan()
  }, [chatPendingPlan, sessionId, clearChatPlan])

  return { confirm, cancel }
}
