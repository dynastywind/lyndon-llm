import { useCallback } from 'react'
import { streamChat } from '@/api/client'
import { useAppStore } from '@/store'

export function useStream() {
  const { sessionId, addMessage, setStreaming, bumpSessionVersion } = useAppStore()

  const send = useCallback(
    async (userMessage: string) => {
      addMessage({ role: 'user', content: userMessage })
      setStreaming(true)

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
        // Signal Sidebar to refresh the sessions list (title + updated_at changed)
        bumpSessionVersion()
      }
    },
    [sessionId, addMessage, setStreaming, bumpSessionVersion],
  )

  return { send }
}
