import { useCallback, useEffect, useLayoutEffect, useRef, useState, Component } from 'react'
import { flushSync } from 'react-dom'
import type { ReactNode, ErrorInfo } from 'react'
import { Send, Loader2, Check, AlertCircle, Copy, Paperclip, X, FileText, Image as ImageIcon } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { CODE_THEMES } from '@/config/codeThemes'
import { CODE_THEME_DEFAULT } from '@/config/codeThemes'
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
import type { Message, ToolCallRecord, ChartSpec, ChartSeries, ChatSessionMessage, MessageAttachment } from '@/types'

// ─── CodeBlock ────────────────────────────────────────────────────────────────

function CodeBlock({ language, code }: { language: string | undefined; code: string }) {
  const [copied, setCopied] = useState(false)
  const themeName = useAppStore((s) => s.codeTheme)
  const theme = CODE_THEMES[themeName] ?? CODE_THEMES[CODE_THEME_DEFAULT]
  const lang = language ?? 'plaintext'

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-border/50 text-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-border/50">
        <span className="text-[11px] font-mono text-muted-foreground/60 select-none">
          {lang}
        </span>
        <button
          onClick={handleCopy}
          className={cn(
            'flex items-center gap-1 text-[11px] transition-colors',
            copied
              ? 'text-green-400'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      {/* Syntax-highlighted code */}
      <SyntaxHighlighter
        language={lang}
        style={theme}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.8rem',
          lineHeight: '1.6',
          padding: '0.85rem 1rem',
        }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

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

// ─── Markdown component overrides ────────────────────────────────────────────
// Defined at module level so the object reference is stable across renders.

const MD_COMPONENTS: Components = {
  // Suppress the <pre> wrapper — CodeBlock provides its own container.
  pre({ children }) {
    return <>{children}</>
  },
  // Route fenced code blocks to CodeBlock; style inline code distinctly.
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className ?? '')
    const code  = String(children).replace(/\n$/, '')

    if (match?.[1] === 'chart') {
      try {
        return <ChartBlock spec={JSON.parse(code) as ChartSpec} />
      } catch {
        return (
          <div className="mt-3 rounded-xl bg-black/20 border border-border/40 p-4 text-xs text-muted-foreground">
            Chart could not be rendered: invalid chart spec
          </div>
        )
      }
    }

    // Inline code: no language tag AND no newlines
    if (!match && !code.includes('\n')) {
      return (
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-[0.85em] font-mono text-zinc-200">
          {children}
        </code>
      )
    }

    return <CodeBlock language={match?.[1]} code={code} />
  },
}

// ─── Attachment helpers ───────────────────────────────────────────────────────

/** Local state shape — object URL for fast preview, revoked on cleanup. */
interface LocalAttachment {
  id: string
  file: File
  /** Blob object URL (images only) — revoked when removed or submitted. */
  previewUrl: string | null
}

/** Read a file and return its full data URL ("data:<type>;base64,…"). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: LocalAttachment
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2 py-1 text-xs max-w-[180px]">
      {attachment.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt={attachment.file.name}
          className="w-6 h-6 rounded object-cover shrink-0"
        />
      ) : (
        <FileText size={12} className="shrink-0 text-muted-foreground" />
      )}
      <span className="truncate text-foreground/70 select-none">{attachment.file.name}</span>
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
      >
        <X size={10} />
      </button>
    </div>
  )
}

// ─── MessageAttachments ───────────────────────────────────────────────────────

function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  if (!attachments.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {attachments.map((a, i) =>
        a.type.startsWith('image/') ? (
          <img
            key={i}
            src={a.dataUrl}
            alt={a.name}
            className="max-w-[220px] max-h-[160px] rounded-xl object-cover"
          />
        ) : (
          <div
            key={i}
            className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2 py-1 text-xs"
          >
            <FileText size={12} className="shrink-0" />
            <span className="truncate max-w-[140px]">{a.name}</span>
          </div>
        ),
      )}
    </div>
  )
}

// ─── MessageActions ───────────────────────────────────────────────────────────

function MessageActions({ msg, isUser }: { msg: Message; isUser: boolean }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className={cn(
        'absolute bottom-0 flex items-center gap-1',
        isUser ? 'right-0' : 'left-0',
        'opacity-0 group-hover/msg:opacity-100',
        'pointer-events-none group-hover/msg:pointer-events-auto',
        'transition-opacity duration-150',
      )}
    >
      {isUser && (
        <span className="text-[11px] text-muted-foreground/60 px-1 select-none">
          {formatTimestamp(msg.timestamp)}
        </span>
      )}
      <button
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy'}
        className={cn(
          'flex items-center justify-center w-6 h-6 rounded-md',
          'bg-popover border border-border shadow-sm',
          'text-muted-foreground hover:text-foreground hover:bg-accent',
          'transition-colors',
        )}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser    = msg.role === 'user'
  const hasCharts = (msg.charts?.length ?? 0) > 0 || msg.content.includes('```chart')

  // Show blinking cursor only when: no content yet AND no tool is actively running
  const hasRunningTool = msg.toolCalls?.some((tc) => tc.status === 'running') ?? false
  const placeholder    = hasRunningTool ? '' : '▌'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="relative group/msg max-w-[75%] pb-7">
          <div className="rounded-2xl rounded-br-sm px-4 py-2.5 text-sm bg-primary text-primary-foreground">
            {msg.attachments && msg.attachments.length > 0 && (
              <MessageAttachments attachments={msg.attachments} />
            )}
            {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
          </div>
          <MessageActions msg={msg} isUser={true} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className={cn('relative group/msg pb-7', hasCharts ? 'w-[85%]' : 'max-w-[75%]')}>
        <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm bg-card border border-border">
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
              components={MD_COMPONENTS}
              className={cn('prose prose-sm prose-invert max-w-none', hasCharts && 'mt-2')}
            >
              {msg.content || placeholder}
            </ReactMarkdown>
          )}
        </div>
        <MessageActions msg={msg} isUser={false} />
      </div>
    </div>
  )
}

// ─── MoreDivider ──────────────────────────────────────────────────────────────

function MoreDivider({ loading, onClick }: { loading: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={!loading ? onClick : undefined}
      className={cn(
        'flex items-center gap-3 py-1 select-none',
        !loading && onClick && 'cursor-pointer',
      )}
    >
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
  } = useAppStore()

  const { send } = useStream()
  const [input, setInput] = useState('')

  // ── Attachments ───────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentsRef = useRef<LocalAttachment[]>([])

  // Keep ref in sync so the unmount cleanup always sees the latest list.
  useEffect(() => { attachmentsRef.current = attachments }, [attachments])

  // Revoke any remaining object URLs when the component unmounts.
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
      })
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setAttachments((prev) => [
      ...prev,
      ...files.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      })),
    ])
    // Reset so the same file can be re-selected if removed and re-added.
    e.target.value = ''
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const item = prev.find((a) => a.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  // Pagination state
  const [hasMore, setHasMore]         = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const cursorRef = useRef<string | undefined>(undefined)

  // DOM refs
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Saved scroll height before a prepend so we can restore position after.
  const savedScrollHeightRef = useRef(0)
  // Stays false until the post-load rAF fires. Blocks onWheel during the
  // brief inertia window after a session switch.
  const canLoadRef = useRef(false)

  const scrollToLatest = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }, [])

  // ── Reset state synchronously on session change ──────────────────────────
  // useLayoutEffect runs before paint so these refs can never bleed stale
  // values from a previous session into the new session's first render.

  useLayoutEffect(() => {
    savedScrollHeightRef.current = 0
    canLoadRef.current = false
  }, [sessionId])

  // ── Load initial 5 messages when sessionId changes ────────────────────────

  useEffect(() => {
    let cancelled = false

    const loadInitial = async () => {
      cursorRef.current = undefined
      setHasMore(false)

      if (!sessionId) return

      // When a new session is lazily created on the first send(), setSessionId()
      // is batched with addMessage() in the same render, so messages are already
      // present when this effect fires.  History loads always call clearMessages()
      // first, so messages.length === 0 for those — safe to proceed.
      if (useAppStore.getState().messages.length > 0) return

      try {
        const { messages: raw, has_more } = await getChatMessages(sessionId, 5)
        if (cancelled) return

        const converted = raw.map(toStoreMessage)
        flushSync(() => {
          setMessages(converted)
          setHasMore(has_more)
        })
        if (converted.length > 0) cursorRef.current = raw[0].created_at

        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        requestAnimationFrame(() => {
          if (cancelled) return   // session changed before rAF fired — don't unlock
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          canLoadRef.current = true
        })
      } catch {
        if (!cancelled) canLoadRef.current = true
      }
    }

    loadInitial()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // ── Scroll to bottom when signalled (during streaming) ───────────────────

  useLayoutEffect(() => {
    if (scrollToBottomTick > 0) scrollToLatest()
  }, [scrollToBottomTick, scrollToLatest])

  // ── Restore scroll position after prepend ────────────────────────────────
  // Keyed on messages.length so this only runs when the list actually grows,
  // not on every render (e.g. setLoadingMore(true) would fire the no-dep
  // version before prependMessages, clearing savedScrollHeightRef too early).

  useLayoutEffect(() => {
    if (!savedScrollHeightRef.current || !scrollRef.current) return
    const delta = scrollRef.current.scrollHeight - savedScrollHeightRef.current
    if (delta > 0) scrollRef.current.scrollTop += delta
    savedScrollHeightRef.current = 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

  // ── Load more (older) messages ────────────────────────────────────────────

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !sessionId) return
    const sid = sessionId
    setLoadingMore(true)
    savedScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0

    try {
      const { messages: raw, has_more } = await getChatMessages(sid, 5, cursorRef.current)
      if (useAppStore.getState().sessionId !== sid) return
      const converted = raw.map(toStoreMessage)
      prependMessages(converted)
      setHasMore(has_more)
      if (converted.length > 0) cursorRef.current = raw[0].created_at
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, sessionId, prependMessages])


  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const msg = input.trim()
    if ((!msg && attachments.length === 0) || isStreaming) return

    // Convert files → data URLs (needed for display AND the API payload).
    let msgAttachments: MessageAttachment[] | undefined
    if (attachments.length > 0) {
      const dataUrls = await Promise.all(attachments.map((a) => fileToDataUrl(a.file)))
      msgAttachments = attachments.map((a, i) => ({
        name: a.file.name,
        type: a.file.type,
        dataUrl: dataUrls[i],
      }))
      // Blob URLs are no longer needed — revoke to free memory.
      attachments.forEach((a) => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl) })
      setAttachments([])
    }

    setInput('')
    await send(msg, msgAttachments)
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-6"
        onWheel={(e) => {
          // deltaY < 0 = scrolling up. onWheel fires even when content doesn't
          // overflow (onScroll would silently miss that case).
          // canLoadRef blocks inertia-scroll carry-over from the previous session.
          if (e.deltaY < 0 && hasMore && canLoadRef.current) loadMore()
        }}
      >
        <div className="mx-auto w-full max-w-4xl px-4 space-y-1">

          {hasMore && <MoreDivider loading={loadingMore} onClick={loadMore} />}

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
          {/* Hidden file picker */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.csv,.json,.py,.ts,.tsx,.js,.jsx,.java,.cpp,.c,.go,.rs,.html,.css"
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Upload button + dropdown */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className={cn(
                  'p-2.5 rounded-xl text-muted-foreground transition-colors',
                  'hover:text-foreground hover:bg-accent',
                  attachments.length > 0 && 'text-primary hover:text-primary',
                )}
                title="Attach files or photos"
              >
                <Paperclip size={16} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                sideOffset={8}
                align="start"
                className={cn(
                  'z-50 min-w-[180px] rounded-xl border border-border',
                  'bg-popover shadow-lg p-1',
                  'data-[state=open]:animate-in data-[state=closed]:animate-out',
                  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                )}
              >
                <DropdownMenu.Item
                  onSelect={() => fileInputRef.current?.click()}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
                    'cursor-pointer outline-none select-none',
                    'text-foreground hover:bg-accent transition-colors',
                  )}
                >
                  <ImageIcon size={14} className="text-muted-foreground shrink-0" />
                  Add files or photos
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Textarea + attachment chips — wrapped so they share one visual container */}
          <div
            className={cn(
              'flex-1 flex flex-col rounded-xl bg-input',
              'ring-1 ring-transparent focus-within:ring-ring transition-shadow',
              'overflow-hidden',
            )}
          >
            {/* Attachment chip strip */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                {attachments.map((a) => (
                  <AttachmentChip key={a.id} attachment={a} onRemove={removeAttachment} />
                ))}
              </div>
            )}
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
              className="resize-none bg-transparent px-4 py-2.5 text-sm focus:outline-none min-h-[42px] max-h-40"
            />
          </div>

          {/* Send button */}
          <button
            type="submit"
            disabled={isStreaming || (!input.trim() && attachments.length === 0)}
            className={cn(
              'p-2.5 rounded-xl bg-primary text-primary-foreground transition-opacity',
              (isStreaming || (!input.trim() && attachments.length === 0)) &&
                'opacity-40 cursor-not-allowed',
            )}
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
