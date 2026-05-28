import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Send, Loader2, Check, AlertCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useStream } from '@/hooks/useStream'
import { getChatMessages } from '@/api/client'
import type { Message, ToolCallRecord, ChatSessionMessage } from '@/types'

// ─── ToolCallRow ──────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  web_search: '🔍',
  rag_query: '📚',
}

function ToolCallRow({ call }: { call: ToolCallRecord }) {
  const icon = TOOL_ICONS[call.name] ?? '⚙️'
  const query = (call.args.query as string | undefined) ?? call.name
  const label =
    call.name === 'web_search' ? `Searched "${query}"`
    : call.name === 'rag_query' ? `Knowledge base "${query}"`
    : query

  return (
    <div
      title={call.preview}
      className={cn(
        'flex items-center gap-1.5 text-xs select-none',
        call.status === 'running' ? 'text-muted-foreground' : 'text-muted-foreground/50',
      )}
    >
      {call.status === 'running' ? (
        <Loader2 size={10} className="animate-spin shrink-0" />
      ) : call.status === 'error' ? (
        <AlertCircle size={10} className="shrink-0 text-destructive/70" />
      ) : (
        <Check size={10} className="shrink-0" />
      )}
      <span>{icon} {label}</span>
    </div>
  )
}

// ─── ToolCallsSection ─────────────────────────────────────────────────────────

function ToolCallsSection({ calls }: { calls: ToolCallRecord[] }) {
  if (!calls.length) return null
  return (
    <div className="mb-2.5 space-y-1.5 border-b border-border/40 pb-2.5">
      {calls.map((call) => (
        <ToolCallRow key={call.id} call={call} />
      ))}
    </div>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'

  // Show blinking cursor only when: no content yet AND no tool is actively running
  const hasRunningTool = msg.toolCalls?.some((tc) => tc.status === 'running') ?? false
  const placeholder = hasRunningTool ? '' : '▌'

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
          <>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <ToolCallsSection calls={msg.toolCalls} />
            )}
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              className="prose prose-sm prose-invert max-w-none"
            >
              {msg.content || placeholder}
            </ReactMarkdown>
          </>
        )}
      </div>
    </div>
  )
}

// ─── MoreDivider ──────────────────────────────────────────────────────────────

function MoreDivider({ loading }: { loading: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1 select-none">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs text-muted-foreground/50 flex items-center gap-1.5">
        {loading
          ? <><Loader2 size={11} className="animate-spin" /> loading</>
          : '— more —'}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function toStoreMessage(m: ChatSessionMessage): Message {
  return {
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'tool',
    content: m.content,
    timestamp: new Date(m.created_at),
    toolName: m.tool_name ?? undefined,
  }
}

// ─── ChatWindow ───────────────────────────────────────────────────────────────

export function ChatWindow() {
  const {
    messages,
    setMessages,
    prependMessages,
    isStreaming,
    sessionId,
    scrollToBottomTick,
    bumpScrollToBottom,
  } = useAppStore()

  const { send } = useStream()
  const [input, setInput] = useState('')

  // Pagination state — reset whenever sessionId changes
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // ISO cursor: the created_at of the oldest currently-displayed message
  const cursorRef = useRef<string | undefined>(undefined)

  // DOM refs
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Saved scroll height before a prepend, so we can restore position
  const savedScrollHeightRef = useRef(0)

  // ── Load initial 5 messages when sessionId changes ────────────────────────

  useEffect(() => {
    let cancelled = false

    const loadInitial = async () => {
      cursorRef.current = undefined
      setHasMore(false)

      try {
        const { messages: raw, has_more } = await getChatMessages(sessionId, 5)
        if (cancelled) return

        const converted = raw.map(toStoreMessage)
        setMessages(converted)
        setHasMore(has_more)
        if (converted.length > 0) {
          cursorRef.current = raw[0].created_at   // oldest message = cursor for next fetch
        }
        bumpScrollToBottom()
      } catch {
        // new / empty session — messages already cleared by Sidebar
      }
    }

    loadInitial()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // ── Scroll to bottom when signalled ───────────────────────────────────────
  // useLayoutEffect fires before the browser paints, so there is no visible
  // flash of the top of the conversation when opening history.

  useLayoutEffect(() => {
    if (scrollToBottomTick > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [scrollToBottomTick])

  // ── Restore scroll position after prepend ─────────────────────────────────

  useLayoutEffect(() => {
    if (savedScrollHeightRef.current && scrollRef.current) {
      scrollRef.current.scrollTop +=
        scrollRef.current.scrollHeight - savedScrollHeightRef.current
      savedScrollHeightRef.current = 0
    }
  })

  // ── Load more (older) messages ────────────────────────────────────────────

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    // Save scroll height before React re-renders with new messages
    savedScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0

    try {
      const { messages: raw, has_more } = await getChatMessages(
        sessionId, 5, cursorRef.current,
      )
      const converted = raw.map(toStoreMessage)
      prependMessages(converted)
      setHasMore(has_more)
      if (converted.length > 0) {
        cursorRef.current = raw[0].created_at
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, sessionId, prependMessages])

  // ── IntersectionObserver on the top sentinel ──────────────────────────────

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore() },
      { threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const msg = input.trim()
    if (!msg || isStreaming) return
    setInput('')
    await send(msg)
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-6">
        <div className="mx-auto w-full max-w-4xl px-4 space-y-4">

          {/* Top sentinel — triggers loadMore when scrolled into view */}
          {hasMore && (
            <div ref={sentinelRef}>
              <MoreDivider loading={loadingMore} />
            </div>
          )}

          {messages.length === 0 && !hasMore && (
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
