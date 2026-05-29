import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Component } from 'react'
import { flushSync, createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode, ErrorInfo } from 'react'
import { Send, Loader2, Check, AlertCircle, Copy, Paperclip, X, FileText, Image as ImageIcon, PanelRight } from 'lucide-react'
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

// ─── Asterisk mark components ─────────────────────────────────────────────────

/** Static mark — logo-asterisk.svg geometry, currentColor. */
function AsteriskMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none"
         stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"
         style={{ flex: 'none' }}>
      <line x1="50"     y1="39"    x2="50"     y2="10" />
      <line x1="59.526" y1="44.5"  x2="84.641" y2="30" />
      <line x1="59.526" y1="55.5"  x2="84.641" y2="70" />
      <line x1="50"     y1="61"    x2="50"     y2="90" />
      <line x1="40.474" y1="55.5"  x2="15.359" y2="70" />
      <line x1="40.474" y1="44.5"  x2="15.359" y2="30" />
      <circle cx="50" cy="50" r="5.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Animated mark — logo-asterisk-animated.svg. Use for "agent is thinking" only. */
function AsteriskAnimated({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none"
         stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"
         className="lv-asterisk-animated"
         style={{ flex: 'none' }}>
      <line className="spoke" x1="50"     y1="39"    x2="50"     y2="10"
        style={{ '--len': '29', '--opmin': '0.55', strokeDasharray: 29,
          animationName: 'emit,flicker', animationDuration: '1.8s,1.1s',
          animationDelay: '0s,0.2s', animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
          animationIterationCount: 'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="59.526" y1="44.5"  x2="84.641" y2="30"
        style={{ '--len': '29', '--opmin': '0.7',  strokeDasharray: 29,
          animationName: 'emit,flicker', animationDuration: '2.1s,1.7s',
          animationDelay: '0.35s,0.8s', animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
          animationIterationCount: 'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="59.526" y1="55.5"  x2="84.641" y2="70"
        style={{ '--len': '29', '--opmin': '0.4',  strokeDasharray: 29,
          animationName: 'emit,flicker', animationDuration: '1.65s,0.95s',
          animationDelay: '1.2s,0.05s', animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
          animationIterationCount: 'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="50"     y1="61"    x2="50"     y2="90"
        style={{ '--len': '29', '--opmin': '0.65', strokeDasharray: 29,
          animationName: 'emit,flicker', animationDuration: '2.3s,2.4s',
          animationDelay: '0.55s,1.3s', animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
          animationIterationCount: 'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="40.474" y1="55.5"  x2="15.359" y2="70"
        style={{ '--len': '29', '--opmin': '0.5',  strokeDasharray: 29,
          animationName: 'emit,flicker', animationDuration: '1.5s,1.25s',
          animationDelay: '1.55s,0.5s', animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
          animationIterationCount: 'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="40.474" y1="44.5"  x2="15.359" y2="30"
        style={{ '--len': '29', '--opmin': '0.75', strokeDasharray: 29,
          animationName: 'emit,flicker', animationDuration: '1.95s,1.85s',
          animationDelay: '0.85s,1.05s', animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
          animationIterationCount: 'infinite,infinite' } as React.CSSProperties} />
      <circle className="core" cx="50" cy="50" r="5.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

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
    <div style={{
      margin: '12px 0', overflow: 'hidden',
      border: '1px solid var(--lv-rule)', fontSize: 13,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 12px', background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid var(--lv-rule)',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
          color: 'var(--lv-mute)', userSelect: 'none',
        }}>{lang}</span>
        <button onClick={handleCopy} style={{
          display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
          cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)',
          color: copied ? 'var(--lv-gold)' : 'var(--lv-mute)',
          transition: 'color 0.15s',
        }}>
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang} style={theme} PreTag="div"
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.78rem', lineHeight: '1.6', padding: '0.8rem 1rem' }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

// ─── ChartBlock ───────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#c8a86a', '#b8b3a8', '#6e695f', '#f4f1ea', '#8a7a5a', '#d4c090', '#a09070',
]

const AXIS_STYLE   = { fill: '#6e695f', fontSize: 11 }
const LEGEND_STYLE = { fontSize: 11, color: '#6e695f' }
const TOOLTIP_STYLE = {
  backgroundColor: '#181818',
  border: '1px solid #232323',
  borderRadius: 0,
  color: '#f4f1ea',
  fontSize: 12,
  fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
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
        <div style={{
          marginTop: 12, background: 'rgba(255,255,255,0.015)',
          border: '1px solid var(--lv-rule)', padding: 14,
          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--lv-mute)',
        }}>
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
    <div style={{
      marginTop: 12, background: 'rgba(255,255,255,0.015)',
      border: '1px solid var(--lv-rule)', padding: 12,
    }}>
      {spec.title && (
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em',
          textTransform: 'uppercase', color: 'var(--lv-mute)',
          marginBottom: 12, textAlign: 'center',
        }}>
          {spec.title}
        </p>
      )}
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

function ToolCallRow({ call }: { call: ToolCallRecord }) {
  const query = (call.args.query as string | undefined) ?? call.name
  const label =
    call.name === 'web_search' ? `web.search  "${query}"`
    : call.name === 'rag_query' ? `rag.query  "${query}"`
    : call.name

  const color = call.status === 'running'
    ? 'var(--lv-soft)' : call.status === 'error'
    ? 'hsl(var(--destructive))' : 'var(--lv-mute)'

  return (
    <div title={call.preview} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: 'var(--font-mono)', fontSize: 10.5, color, userSelect: 'none',
    }}>
      {call.status === 'running' ? (
        <AsteriskAnimated size={14} />
      ) : call.status === 'error' ? (
        <AlertCircle size={10} style={{ flexShrink: 0 }} />
      ) : (
        <span style={{ color: 'var(--lv-gold)', flexShrink: 0 }}>→</span>
      )}
      <span>{label}</span>
    </div>
  )
}

// ─── ToolCallsSection ─────────────────────────────────────────────────────────

function ToolCallsSection({ calls }: { calls: ToolCallRecord[] }) {
  if (!calls.length) return null
  return (
    <div style={{
      marginBottom: 10,
      borderLeft: '2px solid var(--lv-rule-strong)',
      paddingLeft: 12, paddingBottom: 10,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
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
          <div style={{
            marginTop: 12, background: 'rgba(255,255,255,0.015)',
            border: '1px solid var(--lv-rule)', padding: 14,
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--lv-mute)',
          }}>
            Chart could not be rendered: invalid chart spec
          </div>
        )
      }
    }

    // Inline code: no language tag AND no newlines
    if (!match && !code.includes('\n')) {
      return (
        <code style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.84em',
          background: 'rgba(255,255,255,0.06)', padding: '1px 5px',
          color: 'var(--lv-ink)',
        }}>
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

function AttachmentChip({ attachment, onRemove }: { attachment: LocalAttachment; onRemove: (id: string) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      border: '1px solid var(--lv-rule-strong)',
      background: 'rgba(255,255,255,0.04)',
      padding: '3px 8px 3px 4px', maxWidth: 180,
    }}>
      {attachment.previewUrl ? (
        <img src={attachment.previewUrl} alt={attachment.file.name}
             style={{ width: 22, height: 22, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <FileText size={12} style={{ flexShrink: 0, color: 'var(--lv-mute)' }} />
      )}
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5,
        color: 'var(--lv-soft)', overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}>{attachment.file.name}</span>
      <button type="button" onClick={() => onRemove(attachment.id)} style={{
        marginLeft: 2, flexShrink: 0, background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--lv-mute)', padding: 2, lineHeight: 0,
      }}>
        <X size={10} />
      </button>
    </div>
  )
}

// ─── AttachmentPreviewModal ───────────────────────────────────────────────────

/** Extension → Prism language identifier. */
const EXT_LANG: Record<string, string> = {
  py: 'python', js: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
  java: 'java', cpp: 'cpp', c: 'c', go: 'go', rs: 'rust',
  html: 'html', css: 'css', json: 'json', md: 'markdown',
  sh: 'bash', bash: 'bash', yaml: 'yaml', yml: 'yaml',
  toml: 'toml', sql: 'sql', txt: 'plaintext', csv: 'plaintext',
}

function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: MessageAttachment
  onClose: () => void
}) {
  const isImage = attachment.type.startsWith('image/')
  const isPdf   = attachment.type === 'application/pdf'

  // Decode text / code content from the data URL.
  const { text, lang } = useMemo(() => {
    if (isImage || isPdf) return { text: null, lang: 'plaintext' }
    try {
      const b64   = attachment.dataUrl.split(',')[1] ?? ''
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const str   = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      const ext   = attachment.name.split('.').pop()?.toLowerCase() ?? ''
      return { text: str, lang: EXT_LANG[ext] ?? 'plaintext' }
    } catch {
      return { text: null, lang: 'plaintext' }
    }
  }, [attachment, isImage, isPdf])

  const themeName = useAppStore((s) => s.codeTheme)
  const theme     = CODE_THEMES[themeName] ?? CODE_THEMES[CODE_THEME_DEFAULT]

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'relative', display: 'flex', flexDirection: 'column',
          background: 'var(--lv-card)', border: '1px solid var(--lv-rule-strong)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.8)', overflow: 'hidden',
          ...(isImage
            ? { maxWidth: '92vw', maxHeight: '92vh' }
            : { width: 740, maxWidth: '95vw', maxHeight: '88vh' }),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderBottom: '1px solid var(--lv-rule)', flexShrink: 0,
        }}>
          {isImage
            ? <ImageIcon size={13} style={{ color: 'var(--lv-mute)', flexShrink: 0 }} />
            : <FileText  size={13} style={{ color: 'var(--lv-mute)', flexShrink: 0 }} />
          }
          <span style={{
            flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11.5,
            color: 'var(--lv-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{attachment.name}</span>
          <button onClick={onClose} style={{
            flexShrink: 0, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--lv-mute)', padding: 4, lineHeight: 0,
          }}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {isImage ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 16, background: 'rgba(0,0,0,0.2)',
            }}>
              <img src={attachment.dataUrl} alt={attachment.name}
                   style={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain' }} />
            </div>
          ) : isPdf ? (
            <embed src={attachment.dataUrl} type="application/pdf" style={{ width: '100%', height: '72vh' }} />
          ) : text !== null ? (
            <SyntaxHighlighter
              language={lang} style={theme} PreTag="div" showLineNumbers
              customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.78rem', lineHeight: '1.6', padding: '1rem 1rem 1rem 0.5rem' }}
              codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }}
            >
              {text}
            </SyntaxHighlighter>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 160, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--lv-mute)',
            }}>
              Binary file — cannot preview
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── MessageAttachments ───────────────────────────────────────────────────────

function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const [previewing, setPreviewing] = useState<MessageAttachment | null>(null)

  if (!attachments.length) return null
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {attachments.map((a, i) =>
          a.type.startsWith('image/') ? (
            <img
              key={i} src={a.dataUrl} alt={a.name}
              onClick={() => setPreviewing(a)}
              style={{ maxWidth: 200, maxHeight: 150, objectFit: 'cover', cursor: 'pointer' }}
            />
          ) : (
            <div
              key={i} onClick={() => setPreviewing(a)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'rgba(255,255,255,0.08)', padding: '4px 8px',
                cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)',
                fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--lv-soft)',
              }}
            >
              <FileText size={11} style={{ flexShrink: 0 }} />
              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
            </div>
          ),
        )}
      </div>
      {previewing && (
        <AttachmentPreviewModal attachment={previewing} onClose={() => setPreviewing(null)} />
      )}
    </>
  )
}

// ─── ContextPanel ────────────────────────────────────────────────────────────

function formatFileSize(dataUrl: string): string {
  const b64   = dataUrl.split(',')[1] ?? ''
  const bytes = Math.floor(b64.length * 0.75)
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ContextItem({ attachment, onClick }: { attachment: MessageAttachment; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  const isImage = attachment.type.startsWith('image/')
  return (
    <button
      type="button" onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        border: `1px solid ${hov ? 'var(--lv-rule-strong)' : 'var(--lv-rule)'}`,
        background: hov ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'border-color 0.15s, background 0.15s', overflow: 'hidden',
      }}
    >
      {isImage ? (
        <>
          <img src={attachment.dataUrl} alt={attachment.name}
               style={{ width: '100%', height: 112, objectFit: 'cover', display: 'block' }} />
          <div style={{ padding: '6px 8px' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--lv-mute)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{attachment.name}</p>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px' }}>
          <div style={{
            flexShrink: 0, width: 28, height: 28,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--lv-rule)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={12} style={{ color: 'var(--lv-mute)' }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--lv-soft)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{attachment.name}</p>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--lv-mute)', marginTop: 2,
            }}>{formatFileSize(attachment.dataUrl)}</p>
          </div>
        </div>
      )}
    </button>
  )
}

function ContextPanel({ items }: { items: MessageAttachment[] }) {
  const [previewing, setPreviewing] = useState<MessageAttachment | null>(null)

  return (
    <>
      <div style={{ width: 208, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          padding: '18px 20px 14px', borderBottom: '1px solid var(--lv-rule)', flexShrink: 0,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.28em',
            textTransform: 'uppercase', color: 'var(--lv-gold)', fontWeight: 500,
          }}>Context</span>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.length === 0 ? (
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--lv-mute)',
              textAlign: 'center', paddingTop: 24, lineHeight: 1.8, userSelect: 'none',
            }}>Files and photos<br />you share will<br />appear here</p>
          ) : (
            items.map((att, i) => (
              <ContextItem key={i} attachment={att} onClick={() => setPreviewing(att)} />
            ))
          )}
        </div>
      </div>

      {previewing && (
        <AttachmentPreviewModal attachment={previewing} onClose={() => setPreviewing(null)} />
      )}
    </>
  )
}

// ─── MessageActions ───────────────────────────────────────────────────────────

// Individual action button for message toolbar
function MsgActionBtn({
  onClick, title, children,
}: { onClick: () => void; title: string; children: React.ReactNode }) {
  const [h, setH] = useState(false)
  return (
    <button
      onClick={onClick} title={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
        lineHeight: 0, display: 'flex', alignItems: 'center',
        color: h ? 'var(--lv-ink)' : 'var(--lv-mute)',
        transition: 'color 0.2s var(--ease-snap)',
      }}
    >{children}</button>
  )
}

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
        isUser ? 'right-0' : 'left-0',
        'absolute bottom-0 flex items-center gap-1',
        'opacity-0 group-hover/msg:opacity-100',
        'pointer-events-none group-hover/msg:pointer-events-auto',
      )}
      style={{
        transition: 'opacity 0.2s var(--ease-snap), transform 0.2s var(--ease-snap)',
      }}
    >
      {isUser && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--lv-mute)',
          paddingRight: 4, userSelect: 'none',
        }}>
          {formatTimestamp(msg.timestamp)}
        </span>
      )}
      <MsgActionBtn onClick={handleCopy} title={copied ? 'Copied!' : 'Copy'}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </MsgActionBtn>
    </div>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, isLive = false }: { msg: Message; isLive?: boolean }) {
  const [hover, setHover] = useState(false)
  const isUser    = msg.role === 'user'
  const hasCharts = (msg.charts?.length ?? 0) > 0 || msg.content.includes('```chart')
  const hasRunningTool = msg.toolCalls?.some((tc) => tc.status === 'running') ?? false
  const placeholder    = hasRunningTool ? '' : '▌'

  if (isUser) {
    return (
      <div
        style={{ display: 'flex', justifyContent: 'flex-end' }}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      >
        <div className="group/msg" style={{ position: 'relative', maxWidth: '72%', paddingBottom: 28 }}>
          {/* Label row — "You" + time fades in on hover */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end',
            marginBottom: 8,
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--lv-mute)',
              opacity: hover ? 1 : 0,
              transition: 'opacity 0.2s var(--ease-snap)',
            }}>{formatTimestamp(msg.timestamp)}</span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.28em',
              textTransform: 'uppercase', color: 'var(--lv-mute)', fontWeight: 500,
            }}>You</span>
          </div>
          {/* Bubble */}
          <div style={{
            fontFamily: 'var(--font-sans)', fontSize: 14.5, lineHeight: 1.6,
            color: 'var(--lv-ink)', fontWeight: 400,
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--lv-rule)',
            padding: '12px 16px', borderRadius: 4, textAlign: 'left',
          }}>
            {msg.attachments && msg.attachments.length > 0 && (
              <MessageAttachments attachments={msg.attachments} />
            )}
            {msg.content && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.content}</p>}
          </div>
          {/* Hover action row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2,
            marginTop: 6, justifyContent: 'flex-end', marginRight: -4,
            opacity: hover ? 1 : 0,
            transform: hover ? 'translateY(0)' : 'translateY(-3px)',
            pointerEvents: hover ? 'auto' : 'none',
            transition: 'opacity 0.2s var(--ease-snap), transform 0.2s var(--ease-snap)',
          }}>
            <MsgActionBtn onClick={() => { navigator.clipboard.writeText(msg.content).catch(() => {}) }} title="Copy">
              <Copy size={13} />
            </MsgActionBtn>
          </div>
        </div>
      </div>
    )
  }

  // Agent message — left-aligned, no bubble
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}
         onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div
        className="group/msg"
        style={{ position: 'relative', paddingBottom: 28, maxWidth: hasCharts ? '90%' : '76%' }}
      >
        {/* Eyebrow */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          color: 'var(--lv-gold)', marginBottom: 10,
        }}>
          {isLive ? <AsteriskAnimated size={16} /> : <AsteriskMark size={14} />}
          {!isLive && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.28em',
              textTransform: 'uppercase', fontWeight: 500,
            }}>
              {formatTimestamp(msg.timestamp)}
            </span>
          )}
        </div>

        {/* Tool calls */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <ToolCallsSection calls={msg.toolCalls} />
        )}

        {/* Charts */}
        {msg.charts?.map((spec, i) => <ChartBlock key={i} spec={spec} />)}

        {/* Markdown body */}
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
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0',
        userSelect: 'none', cursor: !loading && onClick ? 'pointer' : 'default',
        marginBottom: 8,
      }}
    >
      <div style={{ flex: 1, height: 1, background: 'var(--lv-rule)' }} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--lv-mute)',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {loading ? <><Loader2 size={10} className="animate-spin" /> loading</> : '— more —'}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--lv-rule)' }} />
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
    // Reconstruct full data URLs from the stored {name, type, data} payloads.
    attachments: m.attachments?.length
      ? m.attachments.map((a) => ({
          name: a.name,
          type: a.type,
          dataUrl: `data:${a.type};base64,${a.data}`,
        }))
      : undefined,
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
    sessionTitle,
    scrollToBottomTick,
  } = useAppStore()

  // ── Context panel visibility (hidden by default) ──────────────────────
  const [showContext, setShowContext] = useState(false)

  const { send } = useStream()
  const [input, setInput] = useState('')

  // ── Context panel — collect all attachments from current session ──────
  // Newest-first; deduplicated by data URL prefix so identical files are
  // not listed twice even if sent in multiple messages.
  const contextAttachments = useMemo<MessageAttachment[]>(() => {
    const result: MessageAttachment[] = []
    const seen = new Set<string>()
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const att of messages[i].attachments ?? []) {
        const key = att.dataUrl.slice(0, 80)
        if (!seen.has(key)) {
          seen.add(key)
          result.push(att)
        }
      }
    }
    return result
  }, [messages])

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

  const canSend = !isStreaming && (!!input.trim() || attachments.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--lv-bg)' }}>

      {/* ── Title bar ────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        paddingLeft: 56, height: 48,
        borderBottom: '1px solid var(--lv-rule)', flexShrink: 0,
      }}>
        <div style={{
          fontFamily: 'var(--font-sans)', fontStyle: 'normal', fontWeight: 500,
          fontSize: 14, color: 'var(--lv-ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {sessionTitle ?? 'New chat'}
        </div>
        <button
          type="button"
          onClick={() => setShowContext((v) => !v)}
          title="Toggle context panel"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '0 12px', height: '100%',
            color: showContext ? 'var(--lv-gold)' : 'var(--lv-mute)',
            lineHeight: 0, flexShrink: 0,
            transition: 'color 0.15s',
          }}
        >
          <PanelRight size={15} />
        </button>
      </div>

      {/* ── Body row ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* ── Main column ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>

          {/* Messages scroll area */}
          <div
            ref={scrollRef}
            style={{ flex: 1, overflowY: 'auto', padding: '24px 56px' }}
            onWheel={(e) => {
              if (e.deltaY < 0 && hasMore && canLoadRef.current) loadMore()
            }}
          >
            {hasMore && <MoreDivider loading={loadingMore} onClick={loadMore} />}

            {messages.length === 0 && !hasMore && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200,
              }}>
                <p style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--lv-mute)',
                  letterSpacing: '0.1em',
                }}>
                  Ask anything
                </p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id} msg={msg}
                  isLive={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
                />
              ))}
            </div>

            <div ref={bottomRef} />
          </div>

          {/* ── Input bar ──────────────────────────────────────────────── */}
          <div style={{ borderTop: '1px solid var(--lv-rule)', padding: '14px 56px 18px', flexShrink: 0 }}>
            <form onSubmit={handleSubmit}>
              {/* Hidden file picker */}
              <input
                ref={fileInputRef} type="file" multiple
                accept="image/*,.pdf,.txt,.md,.csv,.json,.py,.ts,.tsx,.js,.jsx,.java,.cpp,.c,.go,.rs,.html,.css"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />

              {/* Attachment chips */}
              {attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {attachments.map((a) => (
                    <AttachmentChip key={a.id} attachment={a} onRemove={removeAttachment} />
                  ))}
                </div>
              )}

              {/* Input row */}
              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: 12,
                borderBottom: '1px solid var(--lv-rule-strong)', paddingBottom: 10,
              }}>
                {/* @ / paperclip icon */}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button type="button" title="Attach files or photos" style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: attachments.length > 0 ? 'var(--lv-gold)' : 'var(--lv-mute)',
                      padding: 0, lineHeight: 0, flexShrink: 0,
                    }}>
                      <Paperclip size={15} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      sideOffset={10} align="start"
                      style={{
                        zIndex: 200, minWidth: 180,
                        background: 'var(--lv-card)', border: '1px solid var(--lv-rule-strong)',
                        padding: 4, boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                      }}
                      className={cn(
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                      )}
                    >
                      <DropdownMenu.Item
                        onSelect={() => fileInputRef.current?.click()}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px', cursor: 'pointer', outline: 'none',
                          fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--lv-ink)',
                        }}
                        className="hover:bg-accent focus:bg-accent transition-colors"
                      >
                        <ImageIcon size={13} style={{ color: 'var(--lv-mute)' }} />
                        Add files or photos
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Textarea */}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e) }
                  }}
                  placeholder="Reply, ask, or @reference a note…"
                  rows={1}
                  style={{
                    flex: 1, background: 'transparent', border: 'none', resize: 'none',
                    fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.5,
                    color: 'var(--lv-ink)', outline: 'none',
                    minHeight: 22, maxHeight: 160,
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onInput={(e: any) => {
                    e.target.style.height = 'auto'
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
                  }}
                />

                {/* Send button — 28×28 ink fill with arrow */}
                <button
                  type="submit"
                  disabled={!canSend}
                  style={{
                    width: 28, height: 28, flexShrink: 0,
                    background: canSend ? 'var(--lv-ink)' : 'var(--lv-rule-strong)',
                    color: 'var(--lv-bg)',
                    border: 'none', cursor: canSend ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s',
                  }}
                >
                  {isStreaming
                    ? <AsteriskAnimated size={16} />
                    : <Send size={13} />}
                </button>
              </div>

              {/* Hints row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14, marginTop: 8,
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--lv-mute)' }}>⌘↵ send</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--lv-mute)' }}>@ reference</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--lv-mute)' }}>
                  llm: claude-sonnet-4 · {sessionTitle ? 'active' : 'new chat'}
                </span>
              </div>
            </form>
          </div>
        </div>

        {/* ── Context panel — slides in from right ───────────────────── */}
        <AnimatePresence>
          {showContext && (
            <motion.div
              key="context-panel"
              style={{ flexShrink: 0, overflow: 'hidden', borderLeft: '1px solid var(--lv-rule)' }}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            >
              <ContextPanel items={contextAttachments} />
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  )
}
