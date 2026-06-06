import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Component,
} from 'react'
import { flushSync, createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode, ErrorInfo } from 'react'
import {
  Send,
  Loader2,
  Check,
  AlertCircle,
  Copy,
  Plus,
  Puzzle,
  X,
  FileText,
  Image as ImageIcon,
  PanelRight,
  ChevronDown,
} from 'lucide-react'
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
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useStream } from '@/hooks/useStream'
import { getChatMessages, getModels, getStreamStatus } from '@/api/client'
import type {
  Message,
  Skill,
  ToolCallRecord,
  ChartSpec,
  ChartSeries,
  ChatSessionMessage,
  MessageAttachment,
} from '@/types'
import { PlanPreviewCard } from '@/components/chat/PlanPreviewCard'

// ─── Asterisk mark components ─────────────────────────────────────────────────

/** Static mark — logo-asterisk.svg geometry, currentColor. */
function AsteriskMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      style={{ flex: 'none' }}
    >
      <line x1="50" y1="39" x2="50" y2="10" />
      <line x1="59.526" y1="44.5" x2="84.641" y2="30" />
      <line x1="59.526" y1="55.5" x2="84.641" y2="70" />
      <line x1="50" y1="61" x2="50" y2="90" />
      <line x1="40.474" y1="55.5" x2="15.359" y2="70" />
      <line x1="40.474" y1="44.5" x2="15.359" y2="30" />
      <circle cx="50" cy="50" r="5.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Animated mark — logo-asterisk-animated.svg. Use for "agent is thinking" only. */
function AsteriskAnimated({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      className="lv-asterisk-animated"
      style={{ flex: 'none' }}
    >
      <line
        className="spoke"
        x1="50"
        y1="39"
        x2="50"
        y2="10"
        style={
          {
            '--len': '29',
            '--opmin': '0.55',
            strokeDasharray: 29,
            animationName: 'emit,flicker',
            animationDuration: '1.8s,1.1s',
            animationDelay: '0s,0.2s',
            animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
            animationIterationCount: 'infinite,infinite',
          } as React.CSSProperties
        }
      />
      <line
        className="spoke"
        x1="59.526"
        y1="44.5"
        x2="84.641"
        y2="30"
        style={
          {
            '--len': '29',
            '--opmin': '0.7',
            strokeDasharray: 29,
            animationName: 'emit,flicker',
            animationDuration: '2.1s,1.7s',
            animationDelay: '0.35s,0.8s',
            animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
            animationIterationCount: 'infinite,infinite',
          } as React.CSSProperties
        }
      />
      <line
        className="spoke"
        x1="59.526"
        y1="55.5"
        x2="84.641"
        y2="70"
        style={
          {
            '--len': '29',
            '--opmin': '0.4',
            strokeDasharray: 29,
            animationName: 'emit,flicker',
            animationDuration: '1.65s,0.95s',
            animationDelay: '1.2s,0.05s',
            animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
            animationIterationCount: 'infinite,infinite',
          } as React.CSSProperties
        }
      />
      <line
        className="spoke"
        x1="50"
        y1="61"
        x2="50"
        y2="90"
        style={
          {
            '--len': '29',
            '--opmin': '0.65',
            strokeDasharray: 29,
            animationName: 'emit,flicker',
            animationDuration: '2.3s,2.4s',
            animationDelay: '0.55s,1.3s',
            animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
            animationIterationCount: 'infinite,infinite',
          } as React.CSSProperties
        }
      />
      <line
        className="spoke"
        x1="40.474"
        y1="55.5"
        x2="15.359"
        y2="70"
        style={
          {
            '--len': '29',
            '--opmin': '0.5',
            strokeDasharray: 29,
            animationName: 'emit,flicker',
            animationDuration: '1.5s,1.25s',
            animationDelay: '1.55s,0.5s',
            animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
            animationIterationCount: 'infinite,infinite',
          } as React.CSSProperties
        }
      />
      <line
        className="spoke"
        x1="40.474"
        y1="44.5"
        x2="15.359"
        y2="30"
        style={
          {
            '--len': '29',
            '--opmin': '0.75',
            strokeDasharray: 29,
            animationName: 'emit,flicker',
            animationDuration: '1.95s,1.85s',
            animationDelay: '0.85s,1.05s',
            animationTimingFunction: 'cubic-bezier(.4,0,.2,1),ease-in-out',
            animationIterationCount: 'infinite,infinite',
          } as React.CSSProperties
        }
      />
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
    <div
      style={{
        margin: '12px 0',
        overflow: 'hidden',
        border: '1px solid var(--lv-rule)',
        fontSize: 13,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 12px',
          background: 'rgba(var(--lv-wash-rgb),0.03)',
          borderBottom: '1px solid var(--lv-rule)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            color: 'var(--lv-mute)',
            userSelect: 'none',
          }}
        >
          {lang}
        </span>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: copied ? 'var(--lv-gold)' : 'var(--lv-mute)',
            transition: 'color 0.15s',
          }}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={theme}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.78rem',
          lineHeight: '1.6',
          padding: '0.8rem 1rem',
        }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

// ─── ChartBlock ───────────────────────────────────────────────────────────────

const CHART_COLORS = ['#c8a86a', '#b8b3a8', '#6e695f', '#f4f1ea', '#8a7a5a', '#d4c090', '#a09070']

const AXIS_STYLE = { fill: 'var(--lv-mute)', fontSize: 11 }
const LEGEND_STYLE = { fontSize: 11, color: 'var(--lv-mute)' }
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--lv-card)',
  border: '1px solid var(--lv-rule)',
  borderRadius: 0,
  color: 'var(--lv-ink)',
  fontSize: 12,
  fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
}

/** Coerce string-number values in data rows to actual numbers (model quirk). */
function normaliseData(data: Record<string, unknown>[], xKey: string): Record<string, unknown>[] {
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
        <div
          style={{
            marginTop: 12,
            background: 'rgba(var(--lv-wash-rgb),0.015)',
            border: '1px solid var(--lv-rule)',
            padding: 14,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--lv-mute)',
          }}
        >
          Chart could not be rendered: {this.state.message}
        </div>
      )
    }
    return this.props.children
  }
}

function ChartInner({ spec }: { spec: ChartSpec }) {
  const data = normaliseData(spec.data ?? [], spec.x_key)
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
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colorOf(i)} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />
      </PieChart>
    ) : spec.type === 'line' ? (
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--lv-rule-strong)" />
        <XAxis dataKey={spec.x_key} tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name ?? s.key}
            stroke={colorOf(i, s.color)}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    ) : spec.type === 'area' ? (
      <AreaChart data={data}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colorOf(i, s.color)} stopOpacity={0.3} />
              <stop offset="95%" stopColor={colorOf(i, s.color)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--lv-rule-strong)" />
        <XAxis dataKey={spec.x_key} tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name ?? s.key}
            stroke={colorOf(i, s.color)}
            fill={`url(#grad-${s.key})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    ) : (
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--lv-rule-strong)" />
        <XAxis dataKey={spec.x_key} tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name ?? s.key}
            fill={colorOf(i, s.color)}
            radius={[3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    )

  return (
    <div
      style={{
        marginTop: 12,
        background: 'rgba(var(--lv-wash-rgb),0.015)',
        border: '1px solid var(--lv-rule)',
        padding: 12,
      }}
    >
      {spec.title && (
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--lv-mute)',
            marginBottom: 12,
            textAlign: 'center',
          }}
        >
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

/** Parse a skill qualified name → { skillId, toolName } or null. */
function parseSkillName(name: string): { skillId: string; toolName: string } | null {
  if (!name.startsWith('skill__')) return null
  const parts = name.split('__')
  // format: skill__{skill_id}__{tool_name}  (skill_id is a UUID — no __ inside)
  if (parts.length < 3) return null
  return { skillId: parts[1], toolName: parts.slice(2).join('__') }
}

function toolLabel(call: ToolCallRecord): string {
  const args = call.args

  // Skill tools — name shown in the badge; label is just the first arg hint
  const skill = parseSkillName(call.name)
  if (skill) {
    const first = Object.entries(args)[0]
    return first ? `${first[0]}=${String(first[1]).slice(0, 50)}` : ''
  }

  switch (call.name) {
    case 'web_search': {
      const q = (args.query as string | undefined) ?? ''
      return `web.search  "${q}"`
    }
    case 'rag_query': {
      const q = (args.query as string | undefined) ?? ''
      return `rag.query  "${q}"`
    }
    case 'run_code': {
      const lang = (args.language as string | undefined) ?? 'code'
      const code = ((args.code as string | undefined) ?? '').trim().split('\n')[0]
      const preview = code.length > 40 ? code.slice(0, 40) + '…' : code
      return `run.code  [${lang}]  ${preview}`
    }
    case 'render_chart': {
      const title = (args.title as string | undefined) ?? ''
      return title ? `render.chart  "${title}"` : 'render.chart'
    }
    default: {
      // Generic: tool.name  key=value for first arg
      const first = Object.entries(args)[0]
      const hint = first ? `  ${first[0]}=${String(first[1]).slice(0, 30)}` : ''
      return `${call.name}${hint}`
    }
  }
}

function ToolCallRow({
  call,
  skillNames = {},
}: {
  call: ToolCallRecord
  skillNames?: Record<string, string>
}) {
  const isActive = call.status === 'active'
  const isRunning = call.status === 'running'
  const isError = call.status === 'error'
  const skillInfo = parseSkillName(call.name)
  const isSkill = skillInfo !== null
  const skillDisplayName = skillInfo ? (skillNames[skillInfo.skillId] ?? skillInfo.toolName) : null

  // Skill tools use a purple/violet accent; regular tools use the default gold/mute
  const runningBg = isSkill ? 'rgba(139,92,246,0.07)' : 'rgba(200,168,106,0.05)'
  const color =
    isRunning || isActive ? 'var(--lv-ink)' : isError ? 'hsl(var(--destructive))' : 'var(--lv-mute)'

  return (
    <div
      title={call.preview}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        color,
        userSelect: 'none',
        background: isRunning ? runningBg : 'transparent',
        padding: isRunning ? '3px 8px 3px 6px' : '0',
        marginLeft: isRunning ? '-6px' : '0',
        borderRadius: isRunning ? 4 : 0,
        transition: 'background 0.2s',
      }}
    >
      {/* status icon */}
      {isRunning ? (
        <AsteriskAnimated size={13} />
      ) : isError ? (
        <AlertCircle size={10} style={{ flexShrink: 0 }} />
      ) : (
        <span style={{ color: 'var(--lv-gold)', flexShrink: 0 }}>✓</span>
      )}

      {/* skill badge — shows the skill's display name */}
      {isSkill && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 9.5,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.04em',
            color: isRunning ? 'rgb(167,139,250)' : 'rgba(139,92,246,0.7)',
            flexShrink: 0,
          }}
        >
          <Puzzle size={9} />
          {skillDisplayName}
        </span>
      )}

      <span>{toolLabel(call)}</span>
    </div>
  )
}

// ─── ToolCallsSection ─────────────────────────────────────────────────────────

function ToolCallsSection({
  calls,
  skillNames = {},
}: {
  calls: ToolCallRecord[]
  skillNames?: Record<string, string>
}) {
  if (!calls.length) return null
  return (
    <div
      style={{
        marginBottom: 10,
        borderLeft: '2px solid var(--lv-rule-strong)',
        paddingLeft: 12,
        paddingBottom: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {calls.map((call) => (
        <ToolCallRow key={call.id} call={call} skillNames={skillNames} />
      ))}
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(date: Date): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = new Date()

  // Compare calendar dates in the user's local timezone
  const localDate = (d: Date) =>
    d.toLocaleDateString([], { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const time = date.toLocaleTimeString([], { timeZone: tz, hour: '2-digit', minute: '2-digit' })

  if (localDate(date) === localDate(now)) return time
  if (localDate(date) === localDate(yesterday)) return `Yesterday · ${time}`
  return (
    date.toLocaleDateString([], { timeZone: tz, month: 'short', day: 'numeric' }) + ' · ' + time
  )
}

// ─── Input overlay renderer ───────────────────────────────────────────────────
// Only renders inline code spans (backtick-wrapped text). Every other character
// is emitted verbatim so the visual layout is pixel-identical to the textarea's
// raw text — the caret never drifts and partial markdown syntax (*, **, #, -)
// is shown as-is instead of being transformed into elements that shift layout.

// Matches a complete inline code span (no newlines inside backticks)
const INLINE_CODE_RE = /`([^`\n]+)`/g
// Matches a bullet list marker at the start of a line (after optional spaces)
const BULLET_RE = /^(\s*)([-*])([ \t])/

/** Render a line's inline content: styled inline-code spans, plain text otherwise. */
function renderLineContent(line: string, keyPrefix: string): React.ReactNode {
  const nodes: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null

  INLINE_CODE_RE.lastIndex = 0
  while ((match = INLINE_CODE_RE.exec(line)) !== null) {
    if (match.index > last) nodes.push(line.slice(last, match.index))
    nodes.push(
      <code
        key={`${keyPrefix}-c${match.index}`}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.88em',
          background: 'rgba(var(--lv-wash-rgb),0.07)',
          padding: '1px 4px',
          borderRadius: 2,
          color: 'var(--lv-ink)',
        }}
      >
        {match[1]}
      </code>,
    )
    last = match.index + match[0].length
  }
  if (last < line.length) nodes.push(line.slice(last))
  return nodes
}

/**
 * Renders the input overlay:
 * - Bullet markers (* / -) at line starts are replaced with a styled • so
 *   the visual looks like a list without adding block-level margin/padding
 *   that would shift vertical layout and break cursor alignment.
 * - Inline code spans (`text`) are styled with a monospace background.
 * - Everything else is emitted verbatim to keep the layout pixel-identical
 *   to the underlying textarea so the caret never drifts.
 */
function renderInputOverlay(text: string, skillName?: string): React.ReactNode {
  // If the input starts with a recognised skill slug, highlight it
  const slashPrefix = skillName && text.startsWith(`/${skillName}`) ? `/${skillName}` : null

  const lines = text.split('\n')
  return lines.map((line, i) => {
    const bulletMatch = BULLET_RE.exec(line)
    let content: React.ReactNode

    if (bulletMatch) {
      const [, indent, , space] = bulletMatch
      const rest = line.slice(indent.length + 1 + space.length)
      content = (
        <>
          {indent}
          <span style={{ color: 'var(--lv-gold)', fontWeight: 600 }}>•</span>
          {space}
          {renderLineContent(rest, `${i}-r`)}
        </>
      )
    } else if (i === 0 && slashPrefix && line.startsWith(slashPrefix)) {
      // Highlight the /skill-name prefix on the first line
      const rest = line.slice(slashPrefix.length)
      content = (
        <>
          <span
            style={{
              background: 'rgba(139,92,246,0.15)',
              color: 'rgb(167,139,250)',
              borderRadius: 3,
              padding: '0 2px',
              margin: '0 -2px',
              fontWeight: 500,
            }}
          >
            {slashPrefix}
          </span>
          {renderLineContent(rest, `${i}-r`)}
        </>
      )
    } else {
      content = renderLineContent(line, `${i}`)
    }

    return (
      <span key={i}>
        {content}
        {i < lines.length - 1 ? '\n' : null}
      </span>
    )
  })
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
    const code = String(children).replace(/\n$/, '')

    if (match?.[1] === 'chart') {
      try {
        return <ChartBlock spec={JSON.parse(code) as ChartSpec} />
      } catch {
        return (
          <div
            style={{
              marginTop: 12,
              background: 'rgba(var(--lv-wash-rgb),0.015)',
              border: '1px solid var(--lv-rule)',
              padding: 14,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--lv-mute)',
            }}
          >
            Chart could not be rendered: invalid chart spec
          </div>
        )
      }
    }

    // Inline code: no language tag AND no newlines
    if (!match && !code.includes('\n')) {
      return (
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.84em',
            background: 'rgba(var(--lv-wash-rgb),0.06)',
            padding: '1px 5px',
            color: 'var(--lv-ink)',
          }}
        >
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
    reader.onload = () => resolve(reader.result as string)
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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        border: '1px solid var(--lv-rule-strong)',
        background: 'rgba(var(--lv-wash-rgb),0.04)',
        padding: '3px 8px 3px 4px',
        maxWidth: 180,
      }}
    >
      {attachment.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt={attachment.file.name}
          style={{ width: 22, height: 22, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <FileText size={12} style={{ flexShrink: 0, color: 'var(--lv-mute)' }} />
      )}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          color: 'var(--lv-soft)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        {attachment.file.name}
      </span>
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        style={{
          marginLeft: 2,
          flexShrink: 0,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--lv-mute)',
          padding: 2,
          lineHeight: 0,
        }}
      >
        <X size={10} />
      </button>
    </div>
  )
}

// ─── AttachmentPreviewModal ───────────────────────────────────────────────────

/** Extension → Prism language identifier. */
const EXT_LANG: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  go: 'go',
  rs: 'rust',
  html: 'html',
  css: 'css',
  json: 'json',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  txt: 'plaintext',
  csv: 'plaintext',
}

function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: MessageAttachment
  onClose: () => void
}) {
  const isImage = attachment.type.startsWith('image/')
  const isPdf = attachment.type === 'application/pdf'

  // Decode text / code content from the data URL.
  const { text, lang } = useMemo(() => {
    if (isImage || isPdf) return { text: null, lang: 'plaintext' }
    try {
      const b64 = attachment.dataUrl.split(',')[1] ?? ''
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const str = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      const ext = attachment.name.split('.').pop()?.toLowerCase() ?? ''
      return { text: str, lang: EXT_LANG[ext] ?? 'plaintext' }
    } catch {
      return { text: null, lang: 'plaintext' }
    }
  }, [attachment, isImage, isPdf])

  const themeName = useAppStore((s) => s.codeTheme)
  const theme = CODE_THEMES[themeName] ?? CODE_THEMES[CODE_THEME_DEFAULT]

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--lv-card)',
          border: '1px solid var(--lv-rule-strong)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.8)',
          overflow: 'hidden',
          ...(isImage
            ? { maxWidth: '92vw', maxHeight: '92vh' }
            : { width: 740, maxWidth: '95vw', maxHeight: '88vh' }),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderBottom: '1px solid var(--lv-rule)',
            flexShrink: 0,
          }}
        >
          {isImage ? (
            <ImageIcon size={13} style={{ color: 'var(--lv-mute)', flexShrink: 0 }} />
          ) : (
            <FileText size={13} style={{ color: 'var(--lv-mute)', flexShrink: 0 }} />
          )}
          <span
            style={{
              flex: 1,
              fontFamily: 'var(--font-mono)',
              fontSize: 11.5,
              color: 'var(--lv-ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {attachment.name}
          </span>
          <button
            onClick={onClose}
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--lv-mute)',
              padding: 4,
              lineHeight: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {isImage ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
                background: 'rgba(0,0,0,0.2)',
              }}
            >
              <img
                src={attachment.dataUrl}
                alt={attachment.name}
                style={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain' }}
              />
            </div>
          ) : isPdf ? (
            <embed
              src={attachment.dataUrl}
              type="application/pdf"
              style={{ width: '100%', height: '72vh' }}
            />
          ) : text !== null ? (
            <SyntaxHighlighter
              language={lang}
              style={theme}
              PreTag="div"
              showLineNumbers
              customStyle={{
                margin: 0,
                borderRadius: 0,
                fontSize: '0.78rem',
                lineHeight: '1.6',
                padding: '1rem 1rem 1rem 0.5rem',
              }}
              codeTagProps={{
                style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
              }}
            >
              {text}
            </SyntaxHighlighter>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 160,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--lv-mute)',
              }}
            >
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
              key={i}
              src={a.dataUrl}
              alt={a.name}
              onClick={() => setPreviewing(a)}
              style={{ maxWidth: 200, maxHeight: 150, objectFit: 'cover', cursor: 'pointer' }}
            />
          ) : (
            <div
              key={i}
              onClick={() => setPreviewing(a)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(var(--lv-wash-rgb),0.08)',
                padding: '4px 8px',
                cursor: 'pointer',
                border: '1px solid rgba(var(--lv-wash-rgb),0.1)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                color: 'var(--lv-soft)',
              }}
            >
              <FileText size={11} style={{ flexShrink: 0 }} />
              <span
                style={{
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {a.name}
              </span>
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
  const b64 = dataUrl.split(',')[1] ?? ''
  const bytes = Math.floor(b64.length * 0.75)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ContextItem({
  attachment,
  onClick,
}: {
  attachment: MessageAttachment
  onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  const isImage = attachment.type.startsWith('image/')
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        border: `1px solid ${hov ? 'var(--lv-rule-strong)' : 'var(--lv-rule)'}`,
        background: hov ? 'rgba(var(--lv-wash-rgb),0.04)' : 'transparent',
        transition: 'border-color 0.15s, background 0.15s',
        overflow: 'hidden',
      }}
    >
      {isImage ? (
        <>
          <img
            src={attachment.dataUrl}
            alt={attachment.name}
            style={{ width: '100%', height: 112, objectFit: 'cover', display: 'block' }}
          />
          <div style={{ padding: '6px 8px' }}>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--lv-mute)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {attachment.name}
            </p>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px' }}>
          <div
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              background: 'rgba(var(--lv-wash-rgb),0.04)',
              border: '1px solid var(--lv-rule)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FileText size={12} style={{ color: 'var(--lv-mute)' }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                color: 'var(--lv-soft)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {attachment.name}
            </p>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9.5,
                color: 'var(--lv-mute)',
                marginTop: 2,
              }}
            >
              {formatFileSize(attachment.dataUrl)}
            </p>
          </div>
        </div>
      )}
    </button>
  )
}

function ContextPanel({
  items,
  sessionPrompt = '',
  promptPending = false,
}: {
  items: MessageAttachment[]
  sessionPrompt?: string
  promptPending?: boolean
}) {
  const [previewing, setPreviewing] = useState<MessageAttachment | null>(null)
  const isEmpty = items.length === 0 && !sessionPrompt

  return (
    <>
      <div style={{ width: 208, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div
          style={{
            padding: '18px 20px 14px',
            borderBottom: '1px solid var(--lv-rule)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9.5,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: 'var(--lv-gold)',
              fontWeight: 500,
            }}
          >
            Context
          </span>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {isEmpty ? (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--lv-mute)',
                textAlign: 'center',
                paddingTop: 24,
                lineHeight: 1.8,
                userSelect: 'none',
              }}
            >
              Files and photos
              <br />
              you share will
              <br />
              appear here
            </p>
          ) : (
            <>
              {/* ── Prompt section ── */}
              {sessionPrompt && (
                <section>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        letterSpacing: '0.22em',
                        textTransform: 'uppercase',
                        color: 'var(--lv-mute)',
                        fontWeight: 500,
                      }}
                    >
                      Prompt
                    </span>
                    {promptPending && (
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 8.5,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: 'var(--lv-gold)',
                          border: '1px solid rgba(200,168,106,0.35)',
                          padding: '1px 5px',
                        }}
                      >
                        pending
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      background: 'rgba(200,168,106,0.06)',
                      border: '1px solid rgba(200,168,106,0.18)',
                      borderLeft: '2px solid var(--lv-gold)',
                      padding: '8px 10px',
                    }}
                  >
                    <p
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10.5,
                        color: 'var(--lv-soft)',
                        lineHeight: 1.65,
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {sessionPrompt}
                    </p>
                  </div>
                </section>
              )}

              {/* ── Attachments section ── */}
              {items.length > 0 && (
                <section>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      color: 'var(--lv-mute)',
                      fontWeight: 500,
                      marginBottom: 8,
                    }}
                  >
                    Files
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map((att, i) => (
                      <ContextItem key={i} attachment={att} onClick={() => setPreviewing(att)} />
                    ))}
                  </div>
                </section>
              )}
            </>
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
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  const [h, setH] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        lineHeight: 0,
        display: 'flex',
        alignItems: 'center',
        color: h ? 'var(--lv-ink)' : 'var(--lv-mute)',
        transition: 'color 0.2s var(--ease-snap)',
      }}
    >
      {children}
    </button>
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
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--lv-mute)',
            paddingRight: 4,
            userSelect: 'none',
          }}
        >
          {formatTimestamp(msg.timestamp)}
        </span>
      )}
      <MsgActionBtn onClick={handleCopy} title={copied ? 'Copied!' : 'Copy'}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </MsgActionBtn>
    </div>
  )
}

// ─── ThinkingBlock ────────────────────────────────────────────────────────────

function ThinkingBlock({ content, isLive }: { content: string; isLive: boolean }) {
  // Expanded while the model is still thinking (no response yet); collapsed once done.
  const [open, setOpen] = useState(isLive)

  // Auto-collapse as soon as the model starts producing the final answer.
  const prevLive = useRef(isLive)
  useEffect(() => {
    if (prevLive.current && !isLive) setOpen(false)
    prevLive.current = isLive
  }, [isLive])

  return (
    <div
      style={{
        marginBottom: 12,
        border: '1px solid var(--lv-rule)',
        background: 'rgba(var(--lv-wash-rgb),0.015)',
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '6px 10px',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9.5,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--lv-mute)',
            flex: 1,
          }}
        >
          {isLive ? 'Reasoning…' : 'Reasoning'}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--lv-mute)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            lineHeight: 1,
          }}
        >
          ∨
        </span>
      </button>

      {/* Body */}
      {open && (
        <div
          style={{
            padding: '8px 10px 10px',
            borderTop: '1px solid var(--lv-rule)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.65,
            color: 'var(--lv-mute)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isLive = false,
  skillNames = {},
}: {
  msg: Message
  isLive?: boolean
  skillNames?: Record<string, string>
}) {
  const [hover, setHover] = useState(false)
  const isUser = msg.role === 'user'
  const hasCharts = (msg.charts?.length ?? 0) > 0 || msg.content.includes('```chart')
  const hasRunningTool = msg.toolCalls?.some((tc) => tc.status === 'running') ?? false
  const placeholder = hasRunningTool ? '' : '▌'

  if (isUser) {
    return (
      <div
        style={{ display: 'flex', justifyContent: 'flex-end' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div
          className="group/msg"
          style={{ position: 'relative', maxWidth: '72%', paddingBottom: 28 }}
        >
          {/* Label row — "You" + time fades in on hover */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              justifyContent: 'flex-end',
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--lv-mute)',
                opacity: hover ? 1 : 0,
                transition: 'opacity 0.2s var(--ease-snap)',
              }}
            >
              {formatTimestamp(msg.timestamp)}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                color: 'var(--lv-mute)',
                fontWeight: 500,
              }}
            >
              You
            </span>
          </div>
          {/* Bubble */}
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 14.5,
              lineHeight: 1.6,
              color: 'var(--lv-ink)',
              fontWeight: 400,
              background: 'rgba(var(--lv-wash-rgb),0.04)',
              border: '1px solid var(--lv-rule)',
              padding: '12px 16px',
              borderRadius: 4,
              textAlign: 'left',
            }}
          >
            {msg.attachments && msg.attachments.length > 0 && (
              <MessageAttachments attachments={msg.attachments} />
            )}
            {msg.content && msg.skillPrefix && msg.content.startsWith(msg.skillPrefix) ? (
              <span style={{ display: 'inline' }}>
                <span
                  style={{
                    background: 'rgba(139,92,246,0.15)',
                    color: 'rgb(167,139,250)',
                    borderRadius: 3,
                    padding: '1px 4px',
                    fontWeight: 500,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.9em',
                    marginRight: 4,
                  }}
                >
                  {msg.skillPrefix}
                </span>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    ...MD_COMPONENTS,
                    p: ({ children }) => (
                      <p style={{ margin: 0, display: 'inline', lineHeight: 1.6 }}>{children}</p>
                    ),
                  }}
                  className="prose prose-sm prose-invert"
                >
                  {msg.content.slice(msg.skillPrefix.length).trimStart()}
                </ReactMarkdown>
              </span>
            ) : (
              msg.content && (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    ...MD_COMPONENTS,
                    p: ({ children }) => <p style={{ margin: 0, lineHeight: 1.6 }}>{children}</p>,
                  }}
                  className="prose prose-sm prose-invert"
                >
                  {msg.content}
                </ReactMarkdown>
              )
            )}
          </div>
          {/* Hover action row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              marginTop: 6,
              justifyContent: 'flex-end',
              marginRight: -4,
              opacity: hover ? 1 : 0,
              transform: hover ? 'translateY(0)' : 'translateY(-3px)',
              pointerEvents: hover ? 'auto' : 'none',
              transition: 'opacity 0.2s var(--ease-snap), transform 0.2s var(--ease-snap)',
            }}
          >
            <MsgActionBtn
              onClick={() => {
                navigator.clipboard.writeText(msg.content).catch(() => {})
              }}
              title="Copy"
            >
              <Copy size={13} />
            </MsgActionBtn>
          </div>
        </div>
      </div>
    )
  }

  // Agent message — left-aligned, no bubble
  return (
    <div
      style={{ display: 'flex', justifyContent: 'flex-start' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="group/msg"
        style={{ position: 'relative', paddingBottom: 28, maxWidth: hasCharts ? '90%' : '76%' }}
      >
        {/* Eyebrow */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--lv-gold)',
            marginBottom: 10,
          }}
        >
          {isLive ? <AsteriskAnimated size={16} /> : <AsteriskMark size={14} />}
          {!isLive && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                fontWeight: 500,
              }}
            >
              {formatTimestamp(msg.timestamp)}
            </span>
          )}
        </div>

        {/* Reasoning / CoT block */}
        {msg.thinking && <ThinkingBlock content={msg.thinking} isLive={isLive && !msg.content} />}

        {/* Tool calls */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <ToolCallsSection calls={msg.toolCalls} skillNames={skillNames} />
        )}

        {/* Charts */}
        {msg.charts?.map((spec, i) => (
          <ChartBlock key={i} spec={spec} />
        ))}

        {/* Markdown body */}
        {(msg.content || !hasCharts) && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={MD_COMPONENTS}
            className={cn('prose prose-sm prose-invert', hasCharts && 'mt-2')}
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
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '4px 0',
        userSelect: 'none',
        cursor: !loading && onClick ? 'pointer' : 'default',
        marginBottom: 8,
      }}
    >
      <div style={{ flex: 1, height: 1, background: 'var(--lv-rule)' }} />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--lv-mute)',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {loading ? (
          <>
            <Loader2 size={10} className="animate-spin" /> loading
          </>
        ) : (
          '— more —'
        )}
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
    toolCalls: m.tool_calls?.length ? m.tool_calls : undefined,
    skillPrefix: m.skill_prefix ?? undefined,
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

// ─── Greeting helper ─────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Night owl'
}

// ─── ChatWindow ───────────────────────────────────────────────────────────────

export function ChatWindow() {
  const {
    user,
    sessionMessages,
    setSessionMessages,
    prependSessionMessages,
    streamingSet,
    sessionId,
    sessionTitle,
    scrollToBottomTick,
    drafts,
    setDraft,
    clearDraft,
    appliedSessionPrompts,
    sessionPrompts,
    selectedModel,
    setSelectedModel,
    effortMode,
    setEffortMode,
    sessionEffortModes,
    setSessionEffortMode,
  } = useAppStore()

  const draftKey = sessionId ?? '__new__'
  const messages = sessionMessages[draftKey] ?? []
  const isStreaming = streamingSet[draftKey] === true

  // ── Context panel visibility (hidden by default) ──────────────────────
  const [showContext, setShowContext] = useState(false)

  // ── Model selector ────────────────────────────────────────────────────
  const [availableModels, setAvailableModels] = useState<string[]>([])
  useEffect(() => {
    getModels()
      .then(({ models }) => {
        setAvailableModels(models)
        if (models.length > 0 && !selectedModel) setSelectedModel(models[0])
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Restore per-session effort on mount ───────────────────────────────
  // ChatWindow is keyed by sessionId (see App.tsx), so it remounts each time
  // the active session changes.  Restoring here means switching back to any
  // thread immediately applies its saved effort mode.
  useEffect(() => {
    if (sessionId && sessionEffortModes[sessionId]) {
      setEffortMode(sessionEffortModes[sessionId])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { send, resume } = useStream()

  // Each session keeps its own draft; initialise from store on mount.
  const [input, setInput] = useState(() => drafts[draftKey] ?? '')

  // ── Slash-command skill picker ────────────────────────────────────────
  const [installedSkills, setInstalledSkills] = useState<Skill[]>([])
  // id → display name map used by ToolCallRow to show the skill name in tool call rows
  const skillNameMap = useMemo(
    () => Object.fromEntries(installedSkills.map((s) => [s.id, s.name])),
    [installedSkills],
  )
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)

  useEffect(() => {
    import('@/api/client').then(({ getSkills }) =>
      getSkills()
        .then(setInstalledSkills)
        .catch(() => {}),
    )
  }, [])

  // Derive the active skill from whatever is at the start of the input.
  const activeSkill = useMemo(() => {
    if (!input.startsWith('/')) return null
    const slug = input.split(/\s/)[0].slice(1).toLowerCase()
    return installedSkills.find((s) => s.name.toLowerCase() === slug) ?? null
  }, [input, installedSkills])

  const filteredSkills = useMemo(() => {
    if (!slashFilter && !slashOpen) return installedSkills
    return installedSkills.filter((s) => s.name.toLowerCase().includes(slashFilter.toLowerCase()))
  }, [installedSkills, slashFilter, slashOpen])

  const selectSlashSkill = (skill: Skill) => {
    const body = input.startsWith('/') ? input.replace(/^\/\S*\s?/, '') : input
    const next = `/${skill.name} ${body}`
    setInput(next)
    setDraft(draftKey, next)
    setSlashOpen(false)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  // ── Context panel — collect all attachments from current session ──────
  // Newest-first; deduplicated by data URL prefix so identical files are
  // not listed twice even if sent in multiple messages.
  // Use sessionMessages[draftKey] directly (stable map lookup) so the
  // memo dependency doesn't recreate on every render.
  const contextAttachments = useMemo<MessageAttachment[]>(() => {
    const msgs = sessionMessages[draftKey] ?? []
    const result: MessageAttachment[] = []
    const seen = new Set<string>()
    for (let i = msgs.length - 1; i >= 0; i--) {
      for (const att of msgs[i].attachments ?? []) {
        const key = att.dataUrl.slice(0, 80)
        if (!seen.has(key)) {
          seen.add(key)
          result.push(att)
        }
      }
    }
    return result
  }, [sessionMessages, draftKey])

  // ── Attachments ───────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachmentsRef = useRef<LocalAttachment[]>([])

  // Keep ref in sync so the unmount cleanup always sees the latest list.
  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

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
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const cursorRef = useRef<string | undefined>(undefined)

  // DOM refs
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
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
  useLayoutEffect(() => {
    canLoadRef.current = false
  }, [sessionId])

  // ── Load initial 5 messages when sessionId changes ────────────────────────

  useEffect(() => {
    let cancelled = false

    const loadInitial = async () => {
      cursorRef.current = undefined
      setHasMore(false)

      if (!sessionId) return

      // Skip DB fetch when:
      // (a) messages already exist for this session (new session lazily created
      //     by send(), or we're returning to a session mid-stream whose messages
      //     are still live in the store)
      const sid = sessionId
      if ((useAppStore.getState().sessionMessages[sid] ?? []).length > 0) {
        canLoadRef.current = true
        return
      }

      try {
        const { messages: raw, has_more } = await getChatMessages(sid, 5)
        if (cancelled) return

        const converted = raw.map(toStoreMessage)
        flushSync(() => {
          setSessionMessages(sid, converted)
          setHasMore(has_more)
        })
        if (converted.length > 0) cursorRef.current = raw[0].created_at

        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        requestAnimationFrame(() => {
          if (cancelled) return // session changed before rAF fired — don't unlock
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          canLoadRef.current = true
        })

        // After loading persisted messages, check whether the backend has an
        // active LLM task for this session (happens when the page was refreshed
        // while the model was generating).  If so, re-attach to the stream.
        try {
          const { streaming } = await getStreamStatus(sid)
          if (!cancelled && streaming) {
            resume(sid) // fire-and-forget — manages its own streaming state
          }
        } catch {
          // status check failed — proceed normally
        }
      } catch {
        if (!cancelled) canLoadRef.current = true
      }
    }

    loadInitial()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // ── Scroll to bottom when signalled (during streaming) ───────────────────

  useLayoutEffect(() => {
    if (scrollToBottomTick > 0) scrollToLatest()
  }, [scrollToBottomTick, scrollToLatest])

  // ── Load more (older) messages ────────────────────────────────────────────
  // Strategy: capture scrollTop + scrollHeight synchronously before the fetch,
  // then use flushSync to commit the prepend in one shot and immediately
  // restore the position. This avoids two bugs in the old approach:
  //   (1) The browser's native overflow-anchor would auto-adjust scrollTop,
  //       then our useLayoutEffect would add delta again → double correction.
  //   (2) The user might scroll further while the fetch is in flight; reading
  //       scrollTop inside useLayoutEffect would use the wrong post-scroll value.

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !sessionId) return
    const el = scrollRef.current
    if (!el) return

    const prevScrollTop = el.scrollTop
    const prevHeight = el.scrollHeight

    setLoadingMore(true)

    try {
      const { messages: raw, has_more } = await getChatMessages(sessionId, 5, cursorRef.current)
      if (useAppStore.getState().sessionId !== sessionId) return
      const converted = raw.map(toStoreMessage)

      // Commit prepend + metadata in one synchronous paint so we only need to
      // read scrollHeight once, immediately after the DOM has settled.
      flushSync(() => {
        prependSessionMessages(sessionId, converted)
        setHasMore(has_more)
      })
      if (converted.length > 0) cursorRef.current = raw[0].created_at

      // Restore: shift scrollTop by exactly the height the new messages added.
      // overflow-anchor:none on the container means the browser won't also
      // auto-adjust, so this single write is the only correction needed.
      el.scrollTop = prevScrollTop + (el.scrollHeight - prevHeight)
    } catch {
      // ignore — user can click the MoreDivider to retry
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, sessionId, prependSessionMessages])

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Strip the /skill-name prefix before sending; the skill_id drives routing.
    // Keep the full original input as displayContent so the bubble shows /skill-name highlighted.
    const rawMsg = activeSkill ? input.replace(/^\/\S+\s*/, '').trim() : input.trim()
    const msg = rawMsg
    const displayContent = activeSkill ? input.trim() : undefined
    const skillPrefix = activeSkill ? `/${activeSkill.name}` : undefined
    // Allow sending with no trailing content when a slash skill is active (the skill itself is the action)
    if ((!msg && !activeSkill && attachments.length === 0) || isStreaming) return

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
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
      })
      setAttachments([])
    }

    setInput('')
    clearDraft(draftKey)
    setSlashOpen(false)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await send(msg, msgAttachments, activeSkill?.id, displayContent, skillPrefix)
  }

  // ─── render ───────────────────────────────────────────────────────────────

  const canSend = !isStreaming && (!!input.trim() || attachments.length > 0)
  const isHome = !sessionId

  // ── Home screen (no active session) ──────────────────────────────────────
  if (isHome) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px',
          background: 'var(--lv-bg)',
          backgroundImage: [
            'radial-gradient(ellipse 80% 60% at 50% 48%, rgba(168,140,80,0.09) 0%, transparent 60%)',
            'radial-gradient(ellipse 120% 80% at 50% 50%, rgba(140,118,72,0.05) 0%, transparent 70%)',
            'radial-gradient(circle at 50% 46%, rgba(200,168,106,0.03) 0%, transparent 40%)',
          ].join(', '),
          minHeight: 0,
        }}
      >
        {/* Greeting */}
        <div
          style={{
            textAlign: 'center',
            marginBottom: 44,
            width: '100%',
            maxWidth: 600,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--lv-gold)' }}>
            <AsteriskMark size={44} />
          </div>
          <div
            style={{
              marginTop: 22,
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: 38,
              letterSpacing: '-0.02em',
              color: 'var(--lv-ink)',
              lineHeight: 1.25,
            }}
          >
            {getGreeting()}
            {user?.username ? `, ${user.username}` : ''}.
          </div>
          <div
            style={{
              marginTop: 14,
              fontFamily: 'var(--font-sans)',
              fontWeight: 300,
              fontSize: 15.5,
              color: 'var(--lv-soft)',
            }}
          >
            What&apos;s on your mind?
          </div>
        </div>

        {/* Input box */}
        <div style={{ maxWidth: 680, width: '100%' }}>
          <div
            data-input-box
            style={{
              background: 'var(--lv-elev)',
              border: '1px solid rgba(200,168,106,0.15)',
              borderRadius: 12,
              overflow: 'hidden',
              transition: 'border-color 0.2s',
            }}
          >
            <form onSubmit={handleSubmit}>
              {/* Hidden file picker */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.csv,.json,.py,.ts,.tsx,.js,.jsx,.java,.cpp,.c,.go,.rs,.html,.css"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />

              {/* Textarea zone */}
              <div style={{ padding: '18px 20px 6px' }}>
                {/* Attachment chips */}
                {attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {attachments.map((a) => (
                      <AttachmentChip key={a.id} attachment={a} onRemove={removeAttachment} />
                    ))}
                  </div>
                )}

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    setDraft(draftKey, e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 280)}px`
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (e.altKey) {
                        e.preventDefault()
                        const el = e.currentTarget
                        const start = el.selectionStart ?? el.value.length
                        const end = el.selectionEnd ?? el.value.length
                        const next = el.value.slice(0, start) + '\n' + el.value.slice(end)
                        flushSync(() => {
                          setInput(next)
                          setDraft(draftKey, next)
                        })
                        el.selectionStart = el.selectionEnd = start + 1
                        el.style.height = 'auto'
                        el.style.height = `${Math.min(el.scrollHeight, 280)}px`
                      } else if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault()
                        handleSubmit(e)
                      }
                    }
                  }}
                  onFocus={(e) => {
                    const box = e.currentTarget.closest<HTMLElement>('div[data-input-box]')
                    if (box) box.style.borderColor = 'rgba(200,168,106,0.28)'
                  }}
                  onBlur={(e) => {
                    const box = e.currentTarget.closest<HTMLElement>('div[data-input-box]')
                    if (box) box.style.borderColor = 'rgba(200,168,106,0.15)'
                  }}
                  placeholder="Ask anything…"
                  rows={3}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: 'var(--lv-ink)',
                    caretColor: 'var(--lv-gold)',
                    minHeight: 56,
                  }}
                />
              </div>

              {/* Toolbar */}
              <div
                style={{
                  borderTop: '1px solid var(--lv-rule)',
                  padding: '9px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {/* Attach button */}
                <DropdownMenu.Root open={attachMenuOpen} onOpenChange={setAttachMenuOpen}>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      title="Add attachment"
                      style={{
                        width: 28,
                        height: 28,
                        flexShrink: 0,
                        borderRadius: '50%',
                        border: `1px solid ${attachMenuOpen || attachments.length > 0 ? 'var(--lv-gold)' : 'var(--lv-rule-strong)'}`,
                        background: 'none',
                        cursor: 'pointer',
                        color:
                          attachMenuOpen || attachments.length > 0
                            ? 'var(--lv-gold)'
                            : 'var(--lv-mute)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'border-color 0.15s, color 0.15s',
                      }}
                    >
                      {attachMenuOpen ? <X size={13} /> : <Plus size={14} />}
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      sideOffset={10}
                      align="start"
                      style={{
                        zIndex: 200,
                        minWidth: 240,
                        background: 'var(--lv-card)',
                        border: '1px solid var(--lv-rule-strong)',
                        borderRadius: 10,
                        padding: '6px 0 8px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
                      }}
                      className={cn(
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                        'data-[state=open]:slide-in-from-bottom-2',
                      )}
                    >
                      <DropdownMenu.Item
                        onSelect={() => fileInputRef.current?.click()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 12px',
                          cursor: 'pointer',
                          outline: 'none',
                          fontFamily: 'var(--font-sans)',
                          fontSize: 12.5,
                          color: 'var(--lv-ink)',
                        }}
                        className="hover:bg-accent focus:bg-accent transition-colors"
                      >
                        <ImageIcon size={13} style={{ color: 'var(--lv-mute)' }} />
                        Add files or photos
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                <span style={{ flex: 1 }} />

                {/* Model dropdown */}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9.5,
                        color: 'var(--lv-soft)',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--lv-gold)',
                          flexShrink: 0,
                        }}
                      />
                      {selectedModel ?? '—'}
                      <ChevronDown size={10} style={{ color: 'var(--lv-mute)' }} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      side="top"
                      align="end"
                      sideOffset={8}
                      style={{
                        zIndex: 200,
                        minWidth: 220,
                        background: 'var(--lv-card)',
                        border: '1px solid var(--lv-rule-strong)',
                        borderRadius: 8,
                        padding: '4px 0',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
                      }}
                      className={cn(
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                        'data-[state=open]:slide-in-from-bottom-2',
                      )}
                    >
                      {/* Model section */}
                      <div
                        style={{
                          padding: '4px 10px 6px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          letterSpacing: '0.28em',
                          textTransform: 'uppercase',
                          color: 'var(--lv-mute)',
                        }}
                      >
                        Model
                      </div>
                      {availableModels.length === 0 ? (
                        <div
                          style={{
                            padding: '8px 14px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: 'var(--lv-mute)',
                          }}
                        >
                          No models found
                        </div>
                      ) : (
                        availableModels.map((m) => (
                          <DropdownMenu.Item
                            key={m}
                            onSelect={() => setSelectedModel(m)}
                            style={{ outline: 'none', cursor: 'pointer' }}
                            className="hover:bg-accent focus:bg-accent transition-colors"
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '7px 14px',
                              }}
                            >
                              <span
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: '50%',
                                  flexShrink: 0,
                                  background:
                                    m === selectedModel ? 'var(--lv-gold)' : 'transparent',
                                  border: m === selectedModel ? 'none' : '1px solid var(--lv-mute)',
                                }}
                              />
                              <span
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 10.5,
                                  color: m === selectedModel ? 'var(--lv-ink)' : 'var(--lv-soft)',
                                }}
                              >
                                {m}
                              </span>
                            </div>
                          </DropdownMenu.Item>
                        ))
                      )}

                      {/* Effort section */}
                      <div style={{ height: 1, background: 'var(--lv-rule)', margin: '4px 0' }} />
                      <div
                        style={{
                          padding: '4px 10px 4px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          letterSpacing: '0.28em',
                          textTransform: 'uppercase',
                          color: 'var(--lv-mute)',
                        }}
                      >
                        Effort
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          border: '1px solid var(--lv-rule)',
                          borderRadius: 999,
                          margin: '4px 8px 8px',
                          overflow: 'hidden',
                        }}
                      >
                        {(['low', 'medium', 'high'] as const).map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => setEffortMode(e)}
                            style={{
                              flex: 1,
                              background: effortMode === e ? 'var(--lv-wash)' : 'transparent',
                              color: effortMode === e ? 'var(--lv-ink)' : 'var(--lv-mute)',
                              border: 'none',
                              padding: '5px 0',
                              cursor: 'pointer',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 10,
                              fontWeight: effortMode === e ? 600 : 400,
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                              borderRadius: 999,
                              transition: 'all 0.15s',
                            }}
                          >
                            {e === 'medium' ? 'Mid' : e.charAt(0).toUpperCase() + e.slice(1)}
                          </button>
                        ))}
                      </div>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Send button */}
                <button
                  type="submit"
                  disabled={!canSend}
                  style={{
                    marginLeft: 8,
                    width: 34,
                    height: 34,
                    flexShrink: 0,
                    background: canSend ? 'var(--lv-gold)' : 'var(--lv-rule-strong)',
                    color: canSend ? 'var(--lv-bg)' : 'var(--lv-mute)',
                    border: 'none',
                    cursor: canSend ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.15s',
                    borderRadius: 6,
                  }}
                >
                  <Send size={16} />
                </button>
              </div>
            </form>
          </div>

          {/* Keyboard hint */}
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9.5,
              color: 'var(--lv-mute)',
              marginTop: 12,
            }}
          >
            ↵ send · ⌥↵ newline
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: 'var(--lv-bg)',
      }}
    >
      {/* ── Title bar ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          paddingLeft: 32,
          paddingBottom: 12,
          height: 'var(--header-h)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'normal',
            fontWeight: 500,
            fontSize: 32,
            color: 'var(--lv-ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {sessionTitle ?? 'New chat'}
        </div>
        <button
          type="button"
          onClick={() => setShowContext((v) => !v)}
          title="Toggle context panel"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 12px',
            height: '100%',
            alignSelf: 'center',
            color: showContext ? 'var(--lv-gold)' : 'var(--lv-mute)',
            lineHeight: 0,
            flexShrink: 0,
            transition: 'color 0.15s',
          }}
        >
          <PanelRight size={22} />
        </button>
      </div>

      {/* ── Body row ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ── Main column ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          {/* Messages scroll area */}
          <div
            ref={scrollRef}
            style={{ flex: 1, overflowY: 'auto', padding: '24px 240px', overflowAnchor: 'none' }}
            onWheel={(e) => {
              if (e.deltaY < 0 && hasMore && canLoadRef.current) loadMore()
            }}
          >
            {hasMore && <MoreDivider loading={loadingMore} onClick={loadMore} />}

            {messages.length === 0 && !hasMore && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 200,
                }}
              >
                <p
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--lv-mute)',
                    letterSpacing: '0.1em',
                  }}
                >
                  Ask anything
                </p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isLive={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
                  skillNames={skillNameMap}
                />
              ))}
            </div>

            <div ref={bottomRef} />
          </div>

          {/* ── Plan preview card ──────────────────────────────────────── */}
          <PlanPreviewCard />

          {/* ── Input bar ──────────────────────────────────────────────── */}
          <div
            style={{
              borderTop: '1px solid var(--lv-rule)',
              padding: '14px 240px 18px',
              flexShrink: 0,
            }}
          >
            <form onSubmit={handleSubmit}>
              {/* Hidden file picker */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
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
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 12,
                  borderBottom: '1px solid var(--lv-rule-strong)',
                  paddingBottom: 10,
                }}
              >
                {/* Circular +/× attach button */}
                <DropdownMenu.Root open={attachMenuOpen} onOpenChange={setAttachMenuOpen}>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      title="Add to message"
                      style={{
                        width: 32,
                        height: 32,
                        flexShrink: 0,
                        borderRadius: '50%',
                        border: `1px solid ${attachMenuOpen || attachments.length > 0 ? 'var(--lv-gold)' : 'var(--lv-rule-strong)'}`,
                        background: 'none',
                        cursor: 'pointer',
                        color:
                          attachMenuOpen || attachments.length > 0
                            ? 'var(--lv-gold)'
                            : 'var(--lv-mute)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'border-color 0.15s, color 0.15s',
                      }}
                    >
                      {attachMenuOpen ? <X size={14} /> : <Plus size={15} />}
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      sideOffset={12}
                      align="start"
                      style={{
                        zIndex: 200,
                        minWidth: 240,
                        background: 'var(--lv-card)',
                        border: '1px solid var(--lv-rule-strong)',
                        borderRadius: 10,
                        padding: '6px 0 8px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
                      }}
                      className={cn(
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                        'data-[state=open]:slide-in-from-bottom-2',
                      )}
                    >
                      <DropdownMenu.Item
                        onSelect={() => fileInputRef.current?.click()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 12px',
                          cursor: 'pointer',
                          outline: 'none',
                          fontFamily: 'var(--font-sans)',
                          fontSize: 12.5,
                          color: 'var(--lv-ink)',
                        }}
                        className="hover:bg-accent focus:bg-accent transition-colors"
                      >
                        <ImageIcon size={13} style={{ color: 'var(--lv-mute)' }} />
                        Add files or photos
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Input wrapper: inline-code overlay behind a transparent textarea.
                    Only backtick spans are rendered — all other syntax (*, **, #, -)
                    is shown as-is so layout stays identical to the raw textarea text
                    and the caret never drifts. */}
                <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                  {/* Slash-command skill picker — floats above the input */}
                  {slashOpen && filteredSkills.length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: 0,
                        right: 0,
                        marginBottom: 6,
                        background: 'var(--lv-card)',
                        border: '1px solid var(--lv-rule-strong)',
                        borderRadius: 8,
                        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                        zIndex: 50,
                        overflow: 'hidden',
                        maxHeight: 220,
                        overflowY: 'auto',
                      }}
                    >
                      {filteredSkills.map((skill, idx) => (
                        <button
                          key={skill.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            selectSlashSkill(skill)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            width: '100%',
                            padding: '8px 12px',
                            background:
                              idx === slashIndex ? 'rgba(139,92,246,0.12)' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontFamily: 'var(--font-sans)',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={() => setSlashIndex(idx)}
                        >
                          <Puzzle size={13} style={{ color: 'rgb(139,92,246)', flexShrink: 0 }} />
                          <span style={{ fontSize: 13, color: 'var(--lv-ink)', fontWeight: 500 }}>
                            /{skill.name}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--lv-mute)',
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {skill.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Inline-code render layer — sits behind the textarea */}
                  {input && (
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 0,
                        pointerEvents: 'none',
                        overflow: 'hidden',
                        fontFamily: 'var(--font-sans)',
                        fontSize: 14,
                        lineHeight: 1.5,
                        color: 'var(--lv-ink)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        padding: 0,
                        margin: 0,
                      }}
                    >
                      {renderInputOverlay(input, activeSkill?.name)}
                    </div>
                  )}

                  {/* Transparent textarea — always on top, captures all input */}
                  <textarea
                    ref={textareaRef}
                    value={input}
                    className={input ? 'chat-input-transparent' : 'chat-input-placeholder'}
                    onChange={(e) => {
                      const val = e.target.value
                      setInput(val)
                      setDraft(draftKey, val)
                      // Slash-command picker: open when "/" typed without an active skill match
                      if (!activeSkill && val.startsWith('/')) {
                        const afterSlash = val.slice(1).split(/\s/)[0]
                        setSlashFilter(afterSlash)
                        setSlashIndex(0)
                        setSlashOpen(true)
                      } else {
                        setSlashOpen(false)
                      }
                    }}
                    onKeyDown={(e) => {
                      // Slash picker keyboard navigation
                      if (slashOpen && filteredSkills.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          setSlashIndex((i) => Math.min(i + 1, filteredSkills.length - 1))
                          return
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          setSlashIndex((i) => Math.max(i - 1, 0))
                          return
                        }
                        if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
                          e.preventDefault()
                          selectSlashSkill(filteredSkills[slashIndex])
                          return
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setSlashOpen(false)
                          return
                        }
                      }
                      if (e.key === 'Enter') {
                        if (e.altKey) {
                          // Alt+↵ → insert newline
                          e.preventDefault()
                          const el = e.currentTarget
                          const start = el.selectionStart ?? el.value.length
                          const end = el.selectionEnd ?? el.value.length
                          const next = el.value.slice(0, start) + '\n' + el.value.slice(end)
                          flushSync(() => {
                            setInput(next)
                            setDraft(draftKey, next)
                          })
                          el.selectionStart = el.selectionEnd = start + 1
                          el.style.height = 'auto'
                          el.style.height = `${Math.min(el.scrollHeight, 320)}px`
                        } else if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
                          // plain ↵ → send
                          e.preventDefault()
                          handleSubmit(e)
                        }
                        // Shift/⌘/Ctrl+↵ → browser default newline
                      }
                    }}
                    placeholder="Continue the thread…"
                    rows={1}
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: 0, // suppress browser-default textarea padding (Safari adds ~2px)
                      margin: 0,
                      resize: 'none',
                      outline: 'none',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 14,
                      lineHeight: 1.5,
                      // Transparent when content is present so markdown layer shows through;
                      // keep ink colour when empty so the placeholder is readable.
                      color: input ? 'transparent' : 'var(--lv-ink)',
                      caretColor: 'var(--lv-ink)',
                      minHeight: 22,
                      maxHeight: 320,
                    }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onInput={(e: any) => {
                      e.target.style.height = 'auto'
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 320)}px`
                    }}
                  />
                </div>

                {/* Send button — gold rectangle with arrow */}
                <button
                  type="submit"
                  disabled={!canSend}
                  style={{
                    width: 40,
                    height: 40,
                    flexShrink: 0,
                    background: canSend ? 'var(--lv-gold)' : 'var(--lv-rule-strong)',
                    color: canSend ? 'var(--lv-bg)' : 'var(--lv-mute)',
                    border: 'none',
                    cursor: canSend ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.15s',
                    borderRadius: 4,
                  }}
                >
                  {isStreaming ? <AsteriskAnimated size={16} /> : <Send size={18} />}
                </button>
              </div>

              {/* Hints row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: 10,
                }}
              >
                <span
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--lv-mute)' }}
                >
                  ↵ send · ⌥↵ newline
                </span>
                <span style={{ flex: 1 }} />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9.5,
                        color: 'var(--lv-soft)',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--lv-gold)',
                          flexShrink: 0,
                        }}
                      />
                      {selectedModel ?? '—'}
                      <ChevronDown size={10} style={{ color: 'var(--lv-mute)' }} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      side="top"
                      align="end"
                      sideOffset={8}
                      style={{
                        zIndex: 200,
                        minWidth: 220,
                        background: 'var(--lv-card)',
                        border: '1px solid var(--lv-rule-strong)',
                        borderRadius: 8,
                        padding: '4px 0',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
                      }}
                      className={cn(
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                        'data-[state=open]:slide-in-from-bottom-2',
                      )}
                    >
                      {availableModels.length === 0 ? (
                        <div
                          style={{
                            padding: '8px 14px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: 'var(--lv-mute)',
                          }}
                        >
                          No models found
                        </div>
                      ) : (
                        availableModels.map((m) => (
                          <DropdownMenu.Item
                            key={m}
                            onSelect={() => setSelectedModel(m)}
                            style={{ outline: 'none', cursor: 'pointer' }}
                            className="hover:bg-accent focus:bg-accent transition-colors"
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '7px 14px',
                              }}
                            >
                              <span
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: '50%',
                                  flexShrink: 0,
                                  background:
                                    m === selectedModel ? 'var(--lv-gold)' : 'transparent',
                                  border: m === selectedModel ? 'none' : '1px solid var(--lv-mute)',
                                }}
                              />
                              <span
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 10.5,
                                  color: m === selectedModel ? 'var(--lv-ink)' : 'var(--lv-soft)',
                                }}
                              >
                                {m}
                              </span>
                            </div>
                          </DropdownMenu.Item>
                        ))
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Effort mode pills */}
                {(['low', 'medium', 'high'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setEffortMode(m)
                      if (sessionId) setSessionEffortMode(sessionId, m)
                    }}
                    style={{
                      marginLeft: m === 'low' ? 10 : 2,
                      padding: '1px 7px',
                      borderRadius: 4,
                      border: `1px solid ${effortMode === m ? 'var(--lv-gold)' : 'var(--lv-rule)'}`,
                      background: effortMode === m ? 'rgba(200,168,106,0.12)' : 'none',
                      color: effortMode === m ? 'var(--lv-gold)' : 'var(--lv-mute)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      transition: 'all 0.15s',
                    }}
                  >
                    {m === 'medium' ? 'mid' : m}
                  </button>
                ))}
              </div>
            </form>
          </div>
        </div>

        {/* ── Context panel — slides in from right ───────────────────── */}
        <AnimatePresence>
          {showContext && (
            <motion.div
              key="context-panel"
              style={{
                flexShrink: 0,
                overflow: 'hidden',
                border: '1px solid var(--lv-rule)',
                borderRadius: 12,
                margin: '8px 8px 8px 0',
              }}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            >
              <ContextPanel
                items={contextAttachments}
                sessionPrompt={
                  // Applied prompt (already sent with first message) takes precedence,
                  // then pending prompt (set but first message not sent yet).
                  sessionId
                    ? (appliedSessionPrompts[sessionId] ??
                      sessionPrompts[sessionId] ??
                      sessionPrompts['__new__'] ??
                      '')
                    : (sessionPrompts['__new__'] ?? '')
                }
                promptPending={
                  // True when the prompt is set but hasn't been sent yet
                  sessionId
                    ? !appliedSessionPrompts[sessionId] &&
                      !!(sessionPrompts[sessionId] ?? sessionPrompts['__new__'])
                    : !!sessionPrompts['__new__']
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
