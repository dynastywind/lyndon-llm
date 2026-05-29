import { useCallback } from 'react'
import { createChatSession, streamChat } from '@/api/client'
import { useAppStore } from '@/store'
import { generateId } from '@/lib/utils'
import type { ToolCallRecord, ChartSpec, MessageAttachment } from '@/types'
import type { AttachmentPayload } from '@/api/client'

function chartSpecToMarkdown(spec: ChartSpec): string {
  return `\n\n\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\`\n\n`
}

export function useStream() {
  const {
    sessionId, setSessionId,
    addSessionMessage,
    startStreaming, stopStreaming,
    bumpSessionVersion, bumpScrollToBottom,
  } = useAppStore()

  const send = useCallback(
    async (userMessage: string, attachments?: MessageAttachment[]) => {
      // Lazily create a session on the very first message.
      let activeSessionId = sessionId
      if (!activeSessionId) {
        try {
          const session = await createChatSession()
          activeSessionId = session.session_id
          setSessionId(activeSessionId)
          bumpSessionVersion()
        } catch {
          return
        }
      }

      // 1. Add user bubble immediately
      addSessionMessage(activeSessionId, { role: 'user', content: userMessage, attachments })
      bumpScrollToBottom()
      startStreaming(activeSessionId)

      // 2. Create an empty assistant bubble with a stable ID
      const msgId = generateId()
      useAppStore.setState((s) => ({
        sessionMessages: {
          ...s.sessionMessages,
          [activeSessionId!]: [
            ...(s.sessionMessages[activeSessionId!] ?? []),
            { id: msgId, role: 'assistant' as const, content: '', timestamp: new Date(), toolCalls: [] },
          ],
        },
      }))

      // Helper: update the assistant message in its session slot
      const updateMsg = (updater: (prev: ReturnType<typeof useAppStore.getState>['sessionMessages'][string][number]) =>
        ReturnType<typeof useAppStore.getState>['sessionMessages'][string][number]) => {
        useAppStore.setState((s) => {
          const msgs = [...(s.sessionMessages[activeSessionId!] ?? [])]
          const idx  = msgs.findIndex((m) => m.id === msgId)
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
        await streamChat(userMessage, activeSessionId, (type, data) => {
          switch (type) {
            case 'token': {
              const text = data.text as string
              updateMsg((m) => ({ ...m, content: m.content + text }))
              bumpScrollToBottom()
              break
            }

            case 'tool_start': {
              const newCall: ToolCallRecord = {
                id:     data.id   as string,
                name:   data.name as string,
                args:   data.args as Record<string, unknown>,
                status: 'running',
              }
              updateMsg((m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), newCall] }))
              break
            }

            case 'tool_result': {
              const { id, success, preview } = data as { id: string; success: boolean; preview: string }
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
              const { total_ms, phases } = data as { total_ms: number; phases: Record<string, number> }
              const parts = Object.entries(phases).map(([k, v]) => `${k}=${v}ms`).join('  ')
              console.info(`[metrics] total=${total_ms}ms  ${parts}`)
              break
            }

            case 'error': {
              console.warn('[stream] backend error event:', data.message)
              break
            }
          }
        }, apiAttachments)
      } finally {
        stopStreaming(activeSessionId)
        bumpScrollToBottom()
        bumpSessionVersion()
      }
    },
    [sessionId, setSessionId, addSessionMessage, startStreaming, stopStreaming, bumpSessionVersion, bumpScrollToBottom],
  )

  return { send }
}
