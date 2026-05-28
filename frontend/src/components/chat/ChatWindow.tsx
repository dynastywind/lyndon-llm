import { useCallback, useEffect, useLayoutEffect, useRef, useState, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Send, Loader2, Check, AlertCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import {
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useStream } from '@/hooks/useStream'
import { getChatMessages } from '@/api/client'
import type { Message, ToolCallRecord, ChartSpec, ChartSeries, ChatSessionMessage } from '@/types'

// ─── ChartBlock ───────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#a78bfa', '#fb923c',
]

const AXIS_STYLE  = { fill: '#71717a', fontSize: 11 }
const LEGEND_STYLE = { fontSize: 11, color: '#71717a' }
const TOOLTIP_STYLE = {
  backgroundColor: '#1c1c1e',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  color: '#e4e4e7',
  fontSize: 12,
}

/** Coerce string-number values in data rows to actual numbers (model quirk). */
function normaliseData(
  data: Record<string, unknown>[],
  xKey: string,
): Record<string, unknown>[] {
  return data.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (k !== xKey && typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
        out[k] = Number(v)
      } else {
        out[k] = v
      }
    }
    return out
  })
}

function resolvedSeries(spec: ChartSpec): ChartSeries[] {
  if (spec.series?.length) return spec.series
  const sample = spec.data[0] ?? {}
  return Object.keys(sample)
    .filter((k) => k !== spec.x_key)
    .map((key) => ({ key }))
}

/** Error boundary — prevents a Recharts crash from taking down the whole page. */
class ChartErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean; message: string }
> {
  state = { crashed: false, message: '' }

  static getDerivedStateFromError(err: Error) {
    return { crashed: true, message: err.message }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[ChartBlock]', err, info)
  }

  render() {
    if (this.state.crashed) {
      return (
        <div className="mt-3 rounded-xl bg-black/20 border border-border/40 p-4 text-xs text-muted-foreground">
          Chart could not be rendered: {this.state.message}
        </div>
      )
    }
    return this.props.children
  }
}

function ChartInner({ spec }: { spec: ChartSpec }) {
  const data   = normaliseData(spec.data ?? [], spec.x_key)
  const series = resolvedSeries({ ...spec, data })

  const colorOf = (i: number, override?: string) =>
    override ?? CHART_COLORS[i % CHART_COLORS.length]

  const inner =
    spec.type === 'pie' ? (
      <PieChart>
        <Pie
          data={data}
          dataKey={series[0]?.key ?? 'value'}
          nameKey={spec.x_key}
          cx="50%" cy="50%"
          outerRadius={80}
          label={({ name, percent }) =>
            `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
          }
          labelLine={false}
        >
          {data.map((_, i) => <Cell key={i} fill={colorOf(i)} />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />
      </PieChart>
    ) : spec.type === 'line' ? (
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
        <XAxis dataKey={spec.x_key} tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key}
            name={s.name ?? s.key} stroke={colorOf(i, s.color)}
            strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    ) : spec.type === 'area' ? (
      <AreaChart data={data}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={colorOf(i, s.color)} stopOpacity={0.3} />
              <stop offset="95%" stopColor={colorOf(i, s.color)} stopOpacity={0}   />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
        <XAxis dataKey={spec.x_key} tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key}
            name={s.name ?? s.key} stroke={colorOf(i, s.color)}
            fill={`url(#grad-${s.key})`} strokeWidth={2} />
        ))}
      </AreaChart>
    ) : (
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
        <XAxis dataKey={spec.x_key} tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name ?? s.key}
            fill={colorOf(i, s.color)} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    )

  return (
    <div className="mt-3 rounded-xl bg-black/20 border border-border/40 p-3">
      {spec.title && (
        <p className="text-xs font-semibold text-muted-foreground mb-3 text-center">
          {spec.title}
        </p>
      )}
      {/* Explicit height div — required by Recharts v3 ResponsiveContainer */}
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          {inner}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ChartBlock({ spec }: { spec: ChartSpec }) {
  return (
    <ChartErrorBoundary>
      <ChartInner spec={spec} />
    </ChartErrorBoundary>
  )
}

// ─── ToolCallRow ──────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  web_search:   '🔍',
  rag_query:    '📚',
  render_chart: '📊',
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(date: Date): string {
  const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = new Date()

  // Compare calendar dates in the user's local timezone
  const localDate = (d: Date) =>
    d.toLocaleDateString([], { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const time = date.toLocaleTimeString([], { timeZone: tz, hour: '2-digit', minute: '2-digit' })

  if (localDate(date) === localDate(now))       return time
  if (localDate(date) === localDate(yesterday)) return `Yesterday · ${time}`
  return date.toLocaleDateString([], { timeZone: tz, month: 'short', day: 'numeric' }) + ' · ' + time
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser    = msg.role === 'user'
  const hasCharts = (msg.charts?.length ?? 0) > 0

  // Show blinking cursor only when: no content yet AND no tool is actively running
  const hasRunningTool = msg.toolCalls?.some((tc) => tc.status === 'running') ?? false
  const placeholder    = hasRunningTool ? '' : '▌'

  if (isUser) {
    return (
      <div className="flex justify-end">
        {/* group/bubble owns max-w so the absolute tooltip stays within it */}
        <div className="relative group/bubble max-w-[75%]">
          <div className="rounded-2xl rounded-br-sm px-4 py-2.5 text-sm bg-primary text-primary-foreground">
            <p className="whitespace-pre-wrap">{msg.content}</p>
          </div>
          {/* Timestamp tooltip — appears above the bubble on hover */}
          <div className="absolute bottom-full right-0 mb-1.5 px-2 py-1 rounded-md bg-popover border border-border text-xs text-muted-foreground whitespace-nowrap shadow-sm opacity-0 group-hover/bubble:opacity-100 transition-opacity duration-150 pointer-events-none">
            {formatTimestamp(msg.timestamp)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm bg-card border border-border',
          hasCharts ? 'w-[85%]' : 'max-w-[75%]',
        )}
      >
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <ToolCallsSection calls={msg.toolCalls} />
        )}
        {msg.charts?.map((spec, i) => (
          <ChartBlock key={i} spec={spec} />
        ))}
        {(msg.content || !hasCharts) && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            className={cn('prose prose-sm prose-invert max-w-none', hasCharts && 'mt-2')}
          >
            {msg.content || placeholder}
          </ReactMarkdown>
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
