import { useCallback } from 'react'
import { streamChat } from '@/api/client'
import { useAppStore } from '@/store'

export function useStream() {
  const { sessionId, addMessage, setStreaming } = useAppStore()

  const send = useCallback(
    async (userMessage: string) => {
      addMessage({ role: 'user', content: userMessage })
      setStreaming(true)

      // Optimistic assistant message
      const assistantId = Math.random().toString(36).slice(2)
      let buffer = ''

      addMessage({ role: 'assistant', content: '' })

      try {
        await streamChat(userMessage, sessionId, (chunk) => {
          buffer += chunk
          // Update last message in place
          useAppStore.setState((s) => {
            const msgs = [...s.messages]
            const last = msgs[msgs.length - 1]
            if (last?.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: buffer }
            }
            return { messages: msgs }
          })
        })
      } finally {
        setStreaming(false)
      }
    },
    [sessionId, addMessage, setStreaming],
  )

  return { send }
}
