import { useRef, useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useStream } from '@/hooks/useStream'
import type { Message } from '@/types'

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-card border border-border rounded-bl-sm',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            className="prose prose-sm prose-invert max-w-none"
          >
            {msg.content || '▌'}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}

export function ChatWindow() {
  const { messages, isStreaming } = useAppStore()
  const { send } = useStream()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const msg = input.trim()
    if (!msg || isStreaming) return
    setInput('')
    await send(msg)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-6">
        <div className="mx-auto w-full max-w-4xl px-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground text-sm">
                Ask anything — I can search the web or query your knowledge base.
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border py-3">
        <form
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-4xl px-4 flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
            placeholder="Message LyndonLLM…"
            rows={1}
            className={cn(
              'flex-1 resize-none bg-input rounded-xl px-4 py-2.5 text-sm',
              'focus:outline-none focus:ring-1 focus:ring-ring',
              'min-h-[42px] max-h-40',
            )}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className={cn(
              'p-2.5 rounded-xl bg-primary text-primary-foreground transition-opacity',
              (isStreaming || !input.trim()) && 'opacity-40 cursor-not-allowed',
            )}
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
