import { useCallback } from 'react'
import { createChatSession, resumeStream, streamChat } from '@/api/client'
import { useAppStore } from '@/store'
import { generateId } from '@/lib/utils'
import type { ToolCallRecord, ChartSpec, MessageAttachment, ChatPlan } from '@/types'
import type { AttachmentPayload } from '@/api/client'

function chartSpecToMarkdown(spec: ChartSpec): string {
  return `\n\n\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\`\n\n`
}

export function useStream() {
  const {
    sessionId,
    setSessionId,
    addSessionMessage,
    startStreaming,
    stopStreaming,
    bumpSessionVersion,
    bumpScrollToBottom,
    systemPrompt,
    sessionPrompts,
    clearSessionPrompt,
    setAppliedSessionPrompt,
    selectedModel,
    effortMode,
    mode,
    setChatPendingPlan,
    setChatPlanStatus,
  } = useAppStore()

  const send = useCallback(
    async (
      userMessage: string,
      attachments?: MessageAttachment[],
      skillId?: string,
      displayContent?: string,
      skillPrefix?: string,
    ) => {
      // Lazily create a session on the very first message.
      let activeSessionId = sessionId
      if (!activeSessionId) {
        try {
          // Use the current app mode so cowork/code sessions get the right mode.
          const sessionMode = mode === 'sandbox' ? 'chat' : mode
          const session = await createChatSession(sessionMode)
          activeSessionId = session.session_id
          setSessionId(activeSessionId)
          bumpSessionVersion()
        } catch {
          return
        }
      }

      // Resolve session prompt — applies to first message only
      const draftKey = activeSessionId
      const sessionPrompt = sessionPrompts[draftKey] ?? sessionPrompts['__new__']
      const existingMessages = useAppStore.getState().sessionMessages[activeSessionId] ?? []
      const isFirstMessage = existingMessages.length === 0

      // Capture the session prompt to pass to the backend (sent separately, not in the bubble)
      let appliedSessionPrompt: string | undefined
      if (isFirstMessage && sessionPrompt) {
        appliedSessionPrompt = sessionPrompt
        // Record it for the context panel and clear from pending store
        setAppliedSessionPrompt(activeSessionId, sessionPrompt)
        clearSessionPrompt(draftKey)
        clearSessionPrompt('__new__')
      }

      // 1. Add user bubble with the original message only (prompt is invisible to the user)
      addSessionMessage(activeSessionId, {
        role: 'user',
        content: displayContent ?? userMessage,
        attachments,
        skillPrefix,
      })
      bumpScrollToBottom()
      startStreaming(activeSessionId)

      // 2. Create an empty assistant bubble with a stable ID
      const msgId = generateId()
      useAppStore.setState((s) => ({
        sessionMessages: {
          ...s.sessionMessages,
          [activeSessionId!]: [
            ...(s.sessionMessages[activeSessionId!] ?? []),
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

      // Helper: update the assistant message in its session slot
      const updateMsg = (
        updater: (
          prev: ReturnType<typeof useAppStore.getState>['sessionMessages'][string][number],
        ) => ReturnType<typeof useAppStore.getState>['sessionMessages'][string][number],
      ) => {
        useAppStore.setState((s) => {
          const msgs = [...(s.sessionMessages[activeSessionId!] ?? [])]
          const idx = msgs.findIndex((m) => m.id === msgId)
          if (idx < 0) return s
          msgs[idx] = updater(msgs[idx])
          return { sessionMessages: { ...s.sessionMessages, [activeSessionId!]: msgs } }
        })
      }

      // Convert MessageAttachment → AttachmentPayload
      const apiAttachments: AttachmentPayload[] | undefined = attachments?.length
        ? attachments.map((a) => ({
            name: a.name,
            type: a.type,
            data: a.dataUrl.split(',')[1] ?? a.dataUrl,
          }))
        : undefined

      try {
        await streamChat(
          userMessage,
          activeSessionId,
          (type, data) => {
            switch (type) {
              case 'token': {
                const text = data.text as string
                updateMsg((m) => ({ ...m, content: m.content + text }))
                bumpScrollToBottom()
                break
              }

              case 'thinking_token': {
                const text = data.text as string
                updateMsg((m) => ({ ...m, thinking: (m.thinking ?? '') + text }))
                break
              }

              case 'skill_activated': {
                // Prompt-based skill — no script runs, but show the skill badge
                const activatedCall: ToolCallRecord = {
                  id: `skill_activated_${data.skill_id as string}`,
                  name: `skill__${data.skill_id as string}__[prompt]`,
                  args: {},
                  status: 'active',
                }
                updateMsg((m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), activatedCall] }))
                break
              }

              case 'tool_start': {
                const newCall: ToolCallRecord = {
                  id: data.id as string,
                  name: data.name as string,
                  args: data.args as Record<string, unknown>,
                  status: 'running',
                }
                updateMsg((m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), newCall] }))
                break
              }

              case 'tool_result': {
                const { id, success, preview } = data as {
                  id: string
                  success: boolean
                  preview: string
                }
                updateMsg((m) => ({
                  ...m,
                  toolCalls: (m.toolCalls ?? []).map((tc) =>
                    tc.id === id
                      ? { ...tc, status: success ? ('done' as const) : ('error' as const), preview }
                      : tc,
                  ),
                }))
                break
              }

              case 'chart': {
                const spec = data.spec as ChartSpec
                updateMsg((m) => ({ ...m, content: m.content + chartSpecToMarkdown(spec) }))
                break
              }

              case 'metrics': {
                const { total_ms, phases } = data as {
                  total_ms: number
                  phases: Record<string, number>
                }
                const parts = Object.entries(phases)
                  .map(([k, v]) => `${k}=${v}ms`)
                  .join('  ')
                console.info(`[metrics] total=${total_ms}ms  ${parts}`)
                break
              }

              case 'plan_preview': {
                // Phase 1 complete — store the plan, remove the empty assistant bubble
                setChatPendingPlan(data as unknown as ChatPlan)
                setChatPlanStatus('pending_confirm')
                useAppStore.setState((s) => ({
                  sessionMessages: {
                    ...s.sessionMessages,
                    [activeSessionId!]: (s.sessionMessages[activeSessionId!] ?? []).filter(
                      (m) => m.id !== msgId,
                    ),
                  },
                }))
                break
              }

              case 'error': {
                console.warn('[stream] backend error event:', data.message)
                break
              }
            }
            // system_prompt is sent only on the first message so the model receives
            // it as immutable context at the top of the conversation; the session
            // prompt follows immediately after.
          },
          apiAttachments,
          isFirstMessage ? systemPrompt || undefined : undefined,
          appliedSessionPrompt,
          selectedModel ?? undefined,
          skillId,
          skillPrefix,
          effortMode,
        )
      } finally {
        stopStreaming(activeSessionId)
        bumpScrollToBottom()
        bumpSessionVersion()
      }
    },
    [
      sessionId,
      setSessionId,
      addSessionMessage,
      startStreaming,
      stopStreaming,
      bumpSessionVersion,
      bumpScrollToBottom,
      systemPrompt,
      sessionPrompts,
      clearSessionPrompt,
      setAppliedSessionPrompt,
      selectedModel,
      effortMode,
      mode,
      setChatPendingPlan,
      setChatPlanStatus,
    ],
  )

  /**
   * Re-attach to an in-progress LLM stream after a page refresh.
   * Adds an empty assistant bubble, replays all accumulated tokens, then
   * continues live until the backend task finishes.
   */
  const resume = useCallback(
    async (targetSessionId: string) => {
      const msgId = generateId()

      // Add an empty assistant bubble to receive the replayed + live tokens
      useAppStore.setState((s) => ({
        sessionMessages: {
          ...s.sessionMessages,
          [targetSessionId]: [
            ...(s.sessionMessages[targetSessionId] ?? []),
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

      const updateMsg = (
        updater: (
          prev: ReturnType<typeof useAppStore.getState>['sessionMessages'][string][number],
        ) => ReturnType<typeof useAppStore.getState>['sessionMessages'][string][number],
      ) => {
        useAppStore.setState((s) => {
          const msgs = [...(s.sessionMessages[targetSessionId] ?? [])]
          const idx = msgs.findIndex((m) => m.id === msgId)
          if (idx < 0) return s
          msgs[idx] = updater(msgs[idx])
          return { sessionMessages: { ...s.sessionMessages, [targetSessionId]: msgs } }
        })
      }

      startStreaming(targetSessionId)
      try {
        await resumeStream(targetSessionId, (type, data) => {
          switch (type) {
            case 'token':
              updateMsg((m) => ({ ...m, content: m.content + (data.text as string) }))
              bumpScrollToBottom()
              break
            case 'thinking_token':
              updateMsg((m) => ({ ...m, thinking: (m.thinking ?? '') + (data.text as string) }))
              break
            case 'skill_activated': {
              const activatedCall: ToolCallRecord = {
                id: `skill_activated_${data.skill_id as string}`,
                name: `skill__${data.skill_id as string}__[prompt]`,
                args: {},
                status: 'active',
              }
              updateMsg((m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), activatedCall] }))
              break
            }
            case 'tool_start': {
              const newCall: ToolCallRecord = {
                id: data.id as string,
                name: data.name as string,
                args: data.args as Record<string, unknown>,
                status: 'running',
              }
              updateMsg((m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), newCall] }))
              break
            }
            case 'tool_result': {
              const { id, success, preview } = data as {
                id: string
                success: boolean
                preview: string
              }
              updateMsg((m) => ({
                ...m,
                toolCalls: (m.toolCalls ?? []).map((tc) =>
                  tc.id === id
                    ? { ...tc, status: success ? ('done' as const) : ('error' as const), preview }
                    : tc,
                ),
              }))
              break
            }
            case 'chart': {
              const spec = data.spec as ChartSpec
              updateMsg((m) => ({ ...m, content: m.content + chartSpecToMarkdown(spec) }))
              break
            }
            case 'plan_preview':
              setChatPendingPlan(data as unknown as ChatPlan)
              setChatPlanStatus('pending_confirm')
              useAppStore.setState((s) => ({
                sessionMessages: {
                  ...s.sessionMessages,
                  [targetSessionId]: (s.sessionMessages[targetSessionId] ?? []).filter(
                    (m) => m.id !== msgId,
                  ),
                },
              }))
              break
            case 'error':
              console.warn('[resume] backend error:', data.message)
              break
            default:
              break
          }
        })
      } catch {
        // Resume failed (stream already finished or 404) — remove the empty bubble
        useAppStore.setState((s) => ({
          sessionMessages: {
            ...s.sessionMessages,
            [targetSessionId]: (s.sessionMessages[targetSessionId] ?? []).filter(
              (m) => m.id !== msgId,
            ),
          },
        }))
      } finally {
        stopStreaming(targetSessionId)
        bumpScrollToBottom()
        bumpSessionVersion()
      }
    },
    [
      startStreaming,
      stopStreaming,
      bumpScrollToBottom,
      bumpSessionVersion,
      setChatPendingPlan,
      setChatPlanStatus,
    ],
  )

  return { send, resume }
}
