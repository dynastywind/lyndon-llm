import { useCallback } from 'react'
import { createChatSession, streamChat } from '@/api/client'
import { useAppStore } from '@/store'
import { generateId } from '@/lib/utils'
import type { ToolCallRecord, ChartSpec } from '@/types'

function chartSpecToMarkdown(spec: ChartSpec): string {
  return `\n\n\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\`\n\n`
}

export function useStream() {
  const { sessionId, setSessionId, addMessage, setStreaming, bumpSessionVersion, bumpScrollToBottom } = useAppStore()

  const send = useCallback(
    async (userMessage: string) => {
      // Lazily create a session on the very first message.
      let activeSessionId = sessionId
      if (!activeSessionId) {
        try {
          const session = await createChatSession()
          activeSessionId = session.session_id
          setSessionId(activeSessionId)
          bumpSessionVersion()   // show the new session in the sidebar
        } catch {
          return   // can't proceed without a session
        }
      }

      // 1. Add user bubble immediately
      addMessage({ role: 'user', content: userMessage })
      bumpScrollToBottom()
      setStreaming(true)

      // 2. Create an empty assistant bubble with a stable ID
      const msgId = generateId()
      useAppStore.setState((s) => ({
        messages: [
          ...s.messages,
          { id: msgId, role: 'assistant', content: '', timestamp: new Date(), toolCalls: [] },
        ],
      }))

      try {
        await streamChat(userMessage, activeSessionId, (type, data) => {
          switch (type) {
            // ── LLM token ─────────────────────────────────────────────
            case 'token': {
              const text = data.text as string
              useAppStore.setState((s) => {
                const msgs = [...s.messages]
                const idx = msgs.findIndex((m) => m.id === msgId)
                if (idx < 0) return s
                msgs[idx] = { ...msgs[idx], content: msgs[idx].content + text }
                return { messages: msgs }
              })
              break
            }

            // ── Tool call started ──────────────────────────────────────
            case 'tool_start': {
              const newCall: ToolCallRecord = {
                id: data.id as string,
                name: data.name as string,
                args: data.args as Record<string, unknown>,
                status: 'running',
              }
              useAppStore.setState((s) => {
                const msgs = [...s.messages]
                const idx = msgs.findIndex((m) => m.id === msgId)
                if (idx < 0) return s
                msgs[idx] = {
                  ...msgs[idx],
                  toolCalls: [...(msgs[idx].toolCalls ?? []), newCall],
                }
                return { messages: msgs }
              })
              break
            }

            // ── Tool call finished ─────────────────────────────────────
            case 'tool_result': {
              const { id, success, preview } = data as {
                id: string; success: boolean; preview: string
              }
              useAppStore.setState((s) => {
                const msgs = [...s.messages]
                const idx = msgs.findIndex((m) => m.id === msgId)
                if (idx < 0) return s
                const toolCalls = (msgs[idx].toolCalls ?? []).map((tc) =>
                  tc.id === id
                    ? { ...tc, status: success ? ('done' as const) : ('error' as const), preview }
                    : tc,
                )
                msgs[idx] = { ...msgs[idx], toolCalls }
                return { messages: msgs }
              })
              break
            }

            // ── Chart ─────────────────────────────────────────────────
            case 'chart': {
              const spec = data.spec as ChartSpec
              useAppStore.setState((s) => {
                const msgs = [...s.messages]
                const idx = msgs.findIndex((m) => m.id === msgId)
                if (idx < 0) return s
                msgs[idx] = {
                  ...msgs[idx],
                  content: msgs[idx].content + chartSpecToMarkdown(spec),
                }
                return { messages: msgs }
              })
              break
            }

            // ── Non-fatal error ────────────────────────────────────────
            case 'error': {
              console.warn('[stream] backend error event:', data.message)
              break
            }
          }
        })
      } finally {
        setStreaming(false)
        bumpScrollToBottom()
        bumpSessionVersion()
      }
    },
    [sessionId, setSessionId, addMessage, setStreaming, bumpSessionVersion, bumpScrollToBottom],
  )

  return { send }
}
