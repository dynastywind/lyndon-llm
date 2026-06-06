// Shared home-screen + thread view used by both CoworkWindow and CodeWindow.
// Cowork and Code modes are desktop-only (guarded upstream by IS_TAURI check).

import { useCallback, useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, ChevronDown, Folder, FolderOpen, Check, Loader2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { useStream } from '@/hooks/useStream'
import { getAllChatMessages, getModels } from '@/api/client'
import type { Message, ChatSessionMessage, ToolCallRecord } from '@/types'
import { cn } from '@/lib/utils'

// ── LV tokens ────────────────────────────────────────────────────────────────
const LV = {
  bg: 'var(--lv-bg)',
  elev: 'var(--lv-elev)',
  ink: 'var(--lv-ink)',
  soft: 'var(--lv-soft)',
  mute: 'var(--lv-mute)',
  rule: 'var(--lv-rule)',
  ruleStrong: 'var(--lv-rule-strong)',
  gold: 'var(--lv-gold)',
  goldSoft: 'var(--lv-gold-soft)',
  wash: 'var(--lv-wash)',
  washSoft: 'var(--lv-wash-soft)',
  shadow: '0 8px 32px rgba(0,0,0,0.7)',
  font: {
    sans: 'var(--font-sans)',
    display: 'var(--font-display)',
    mono: 'var(--font-mono)',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
}

function toStoreMessage(m: ChatSessionMessage): Message {
  return {
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'tool',
    content: m.content,
    timestamp: new Date(m.created_at),
    toolName: m.tool_name ?? undefined,
    toolCalls: m.tool_calls?.length ? m.tool_calls : undefined,
    skillPrefix: m.skill_prefix ?? undefined,
    attachments: m.attachments?.length
      ? m.attachments.map((a) => ({
          name: a.name,
          type: a.type,
          dataUrl: `data:${a.type};base64,${a.data}`,
        }))
      : undefined,
  }
}

// ── Mark logo (asterisk) ─────────────────────────────────────────────────────
function Mark({ size = 36, color = LV.gold }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke={color}
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
      <circle cx="50" cy="50" r="5.5" fill={color} stroke="none" />
    </svg>
  )
}

// ── Tool call card ────────────────────────────────────────────────────────────
function ToolCallCard({ tc }: { tc: ToolCallRecord }) {
  const toolLabel = tc.name.startsWith('skill__') ? 'skill' : tc.name
  const argsStr = tc.args && Object.keys(tc.args).length > 0 ? JSON.stringify(tc.args) : ''
  const statusColor = tc.status === 'done' ? LV.gold : tc.status === 'error' ? '#dc2626' : LV.mute

  return (
    <div
      style={{
        border: `1px solid ${LV.rule}`,
        background: LV.washSoft,
        margin: '10px 0',
        padding: '10px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: LV.font.mono,
            fontSize: 9.5,
            letterSpacing: '0.28em',
            textTransform: 'uppercase' as const,
            color: LV.mute,
          }}
        >
          Tool · {toolLabel}
        </span>
        {argsStr && (
          <span
            style={{
              fontFamily: LV.font.mono,
              fontSize: 10.5,
              color: LV.soft,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap' as const,
              maxWidth: 300,
            }}
          >
            {argsStr}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: LV.font.mono, fontSize: 10, color: statusColor }}>
          {tc.status}
        </span>
      </div>
      {tc.preview && (
        <pre
          style={{
            marginTop: 8,
            fontFamily: LV.font.mono,
            fontSize: 11,
            color: LV.soft,
            whiteSpace: 'pre-wrap' as const,
            wordBreak: 'break-all' as const,
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          {tc.preview}
        </pre>
      )}
    </div>
  )
}

// ── Message row ───────────────────────────────────────────────────────────────
function MessageRow({ msg, isLast }: { msg: Message; isLast: boolean }) {
  if (msg.role === 'tool') return null

  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <div
          style={{
            fontFamily: LV.font.mono,
            fontSize: 10,
            color: LV.mute,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
          }}
        >
          You
        </div>
        <div
          style={{
            fontFamily: LV.font.sans,
            fontSize: 14.5,
            lineHeight: 1.65,
            color: LV.ink,
            maxWidth: 560,
            background: LV.wash,
            border: `1px solid ${LV.rule}`,
            padding: '12px 16px',
            borderRadius: 4,
            textAlign: 'left' as const,
            whiteSpace: 'pre-wrap' as const,
            wordBreak: 'break-word' as const,
          }}
        >
          {msg.content}
        </div>
      </div>
    )
  }

  // assistant
  const hasContent = msg.content.trim().length > 0
  const hasTools = (msg.toolCalls ?? []).length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          fontFamily: LV.font.mono,
          fontSize: 10,
          color: LV.gold,
          letterSpacing: '0.28em',
          textTransform: 'uppercase' as const,
        }}
      >
        LyndonLLM{msg.timestamp ? ` · ${relativeTime(msg.timestamp)}` : ''}
        {isLast && !hasContent && !hasTools && (
          <span style={{ marginLeft: 8 }}>
            <Loader2 size={10} className="animate-spin" style={{ display: 'inline-block' }} />
          </span>
        )}
      </div>

      {hasTools && (
        <div>
          {(msg.toolCalls ?? []).map((tc) => (
            <ToolCallCard key={tc.id} tc={tc} />
          ))}
        </div>
      )}

      {hasContent && (
        <div
          style={{
            fontFamily: LV.font.sans,
            fontSize: 14.5,
            lineHeight: 1.7,
            color: LV.ink,
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p style={{ margin: '0 0 10px', lineHeight: 1.7 }}>{children}</p>
              ),
              code: ({
                inline,
                children,
                ...props
              }: {
                inline?: boolean
                children?: React.ReactNode
              }) =>
                inline ? (
                  <code
                    style={{
                      fontFamily: LV.font.mono,
                      fontSize: 12,
                      background: LV.wash,
                      padding: '1px 5px',
                      borderRadius: 3,
                      color: LV.gold,
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                ) : (
                  <pre
                    style={{
                      fontFamily: LV.font.mono,
                      fontSize: 12,
                      background: LV.elev,
                      border: `1px solid ${LV.rule}`,
                      padding: '12px 14px',
                      overflow: 'auto',
                      margin: '10px 0',
                      lineHeight: 1.6,
                    }}
                  >
                    <code {...props}>{children}</code>
                  </pre>
                ),
              ul: ({ children }) => (
                <ul style={{ margin: '0 0 10px 18px', padding: 0 }}>{children}</ul>
              ),
              ol: ({ children }) => (
                <ol style={{ margin: '0 0 10px 18px', padding: 0 }}>{children}</ol>
              ),
              li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
              strong: ({ children }) => (
                <strong style={{ fontWeight: 600, color: LV.ink }}>{children}</strong>
              ),
              h1: ({ children }) => (
                <h1 style={{ fontSize: 18, fontWeight: 600, margin: '16px 0 8px', color: LV.ink }}>
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 style={{ fontSize: 16, fontWeight: 600, margin: '14px 0 6px', color: LV.ink }}>
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: '12px 0 4px', color: LV.ink }}>
                  {children}
                </h3>
              ),
              blockquote: ({ children }) => (
                <blockquote
                  style={{
                    borderLeft: `3px solid ${LV.gold}`,
                    paddingLeft: 12,
                    margin: '10px 0',
                    color: LV.soft,
                  }}
                >
                  {children}
                </blockquote>
              ),
            }}
          >
            {msg.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}

// ── Inline effort switcher (used inside model dropdown) ───────────────────────
function EffortSwitcher({
  effort,
  onChange,
}: {
  effort: 'low' | 'medium' | 'high'
  onChange: (e: 'low' | 'medium' | 'high') => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        border: `1px solid ${LV.rule}`,
        borderRadius: 999,
        margin: '4px 8px 8px',
        overflow: 'hidden',
      }}
    >
      {(['low', 'medium', 'high'] as const).map((e) => {
        const active = effort === e
        return (
          <button
            key={e}
            type="button"
            onClick={() => onChange(e)}
            style={{
              flex: 1,
              background: active ? LV.wash : 'transparent',
              color: active ? LV.ink : LV.mute,
              border: 'none',
              padding: '5px 0',
              cursor: 'pointer',
              fontFamily: LV.font.mono,
              fontSize: 10,
              fontWeight: active ? 600 : 400,
              letterSpacing: '0.04em',
              textTransform: 'uppercase' as const,
              borderRadius: 999,
              transition: 'all 0.15s',
            }}
          >
            {e === 'medium' ? 'Mid' : e.charAt(0).toUpperCase() + e.slice(1)}
          </button>
        )
      })}
    </div>
  )
}

// ── Model dropdown ────────────────────────────────────────────────────────────
function ModelDropdown({
  models,
  selectedModel,
  effortMode,
  onSelectModel,
  onSelectEffort,
}: {
  models: string[]
  selectedModel: string | null
  effortMode: 'low' | 'medium' | 'high'
  onSelectModel: (m: string) => void
  onSelectEffort: (e: 'low' | 'medium' | 'high') => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: 999,
            transition: 'all 0.18s',
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: LV.gold,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: LV.font.mono,
              fontSize: 10,
              color: LV.soft,
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {selectedModel ?? '—'}
          </span>
          <ChevronDown size={11} style={{ color: LV.mute, flexShrink: 0 }} />
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
            border: `1px solid ${LV.ruleStrong}`,
            borderRadius: 8,
            padding: '4px 0',
            boxShadow: LV.shadow,
          }}
          className={cn(
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=open]:slide-in-from-bottom-2',
          )}
        >
          <div
            style={{
              padding: '4px 10px 6px',
              fontFamily: LV.font.mono,
              fontSize: 9,
              letterSpacing: '0.28em',
              textTransform: 'uppercase' as const,
              color: LV.mute,
            }}
          >
            Model
          </div>
          {models.map((m) => (
            <DropdownMenu.Item
              key={m}
              onSelect={() => onSelectModel(m)}
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
                    background: m === selectedModel ? LV.gold : 'transparent',
                    border: m === selectedModel ? 'none' : `1px solid ${LV.mute}`,
                  }}
                />
                {m === selectedModel && <Check size={0} />}
                <span
                  style={{
                    fontFamily: LV.font.mono,
                    fontSize: 10.5,
                    color: m === selectedModel ? LV.ink : LV.soft,
                  }}
                >
                  {m}
                </span>
              </div>
            </DropdownMenu.Item>
          ))}

          <div style={{ height: 1, background: LV.rule, margin: '4px 0' }} />
          <div
            style={{
              padding: '4px 10px 4px',
              fontFamily: LV.font.mono,
              fontSize: 9,
              letterSpacing: '0.28em',
              textTransform: 'uppercase' as const,
              color: LV.mute,
            }}
          >
            Effort
          </div>
          <EffortSwitcher effort={effortMode} onChange={onSelectEffort} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── Directory dropdown ────────────────────────────────────────────────────────
const COMMON_DIRS = ['~/projects', '~/Documents', '~/Desktop']

function DirectoryChip({
  directory,
  onChange,
}: {
  directory: string | null
  onChange: (d: string | null) => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: directory ? LV.wash : 'transparent',
            border: `1px solid ${LV.rule}`,
            padding: '5px 12px 5px 8px',
            cursor: 'pointer',
            borderRadius: 999,
            transition: 'all 0.18s',
          }}
        >
          <span style={{ color: directory ? LV.gold : LV.mute, lineHeight: 0 }}>
            <Folder size={13} />
          </span>
          <span
            style={{
              fontFamily: LV.font.mono,
              fontSize: 11,
              color: directory ? LV.soft : LV.mute,
              letterSpacing: '0.02em',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {directory ?? 'Set directory'}
          </span>
          <ChevronDown size={11} style={{ color: LV.mute, flexShrink: 0 }} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          style={{
            zIndex: 200,
            minWidth: 240,
            background: 'var(--lv-card)',
            border: `1px solid ${LV.ruleStrong}`,
            borderRadius: 8,
            padding: '4px 0',
            boxShadow: LV.shadow,
          }}
          className={cn(
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=open]:slide-in-from-bottom-2',
          )}
        >
          <div
            style={{
              padding: '4px 10px 6px',
              fontFamily: LV.font.mono,
              fontSize: 9,
              letterSpacing: '0.28em',
              textTransform: 'uppercase' as const,
              color: LV.mute,
            }}
          >
            Work Directory
          </div>
          {COMMON_DIRS.map((d) => (
            <DropdownMenu.Item
              key={d}
              onSelect={() => onChange(d)}
              style={{ outline: 'none', cursor: 'pointer' }}
              className="hover:bg-accent focus:bg-accent transition-colors"
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                }}
              >
                <span style={{ fontFamily: LV.font.sans, fontSize: 12.5, color: LV.ink }}>{d}</span>
                {d === directory && (
                  <Check size={13} style={{ color: LV.gold, marginLeft: 'auto' }} />
                )}
              </div>
            </DropdownMenu.Item>
          ))}
          <div style={{ height: 1, background: LV.rule, margin: '4px 0' }} />
          <DropdownMenu.Item
            onSelect={() => onChange(null)}
            style={{ outline: 'none', cursor: 'pointer' }}
            className="hover:bg-accent focus:bg-accent transition-colors"
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
              }}
            >
              <FolderOpen size={14} style={{ color: LV.mute }} />
              <span style={{ fontFamily: LV.font.sans, fontSize: 12.5, color: LV.soft }}>
                Browse…
              </span>
            </div>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── Acting mode dropdown ──────────────────────────────────────────────────────
function ActingModeChip({
  actingMode,
  onChange,
}: {
  actingMode: 'ask' | 'auto'
  onChange: (m: 'ask' | 'auto') => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: 'transparent',
            border: `1px solid ${LV.rule}`,
            padding: '5px 12px 5px 8px',
            cursor: 'pointer',
            borderRadius: 999,
            transition: 'all 0.18s',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              flexShrink: 0,
              background: actingMode === 'auto' ? LV.gold : LV.soft,
            }}
          />
          <span
            style={{
              fontFamily: LV.font.mono,
              fontSize: 10.5,
              color: LV.soft,
              letterSpacing: '0.02em',
            }}
          >
            {actingMode === 'auto' ? 'Act' : 'Ask first'}
          </span>
          <ChevronDown size={11} style={{ color: LV.mute, flexShrink: 0 }} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          style={{
            zIndex: 200,
            minWidth: 220,
            background: 'var(--lv-card)',
            border: `1px solid ${LV.ruleStrong}`,
            borderRadius: 8,
            padding: '4px 0',
            boxShadow: LV.shadow,
          }}
          className={cn(
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=open]:slide-in-from-bottom-2',
          )}
        >
          <div
            style={{
              padding: '4px 10px 6px',
              fontFamily: LV.font.mono,
              fontSize: 9,
              letterSpacing: '0.28em',
              textTransform: 'uppercase' as const,
              color: LV.mute,
            }}
          >
            Acting Mode
          </div>
          {(
            [
              {
                id: 'ask' as const,
                label: 'Ask before acting',
                hint: 'Confirm before making changes',
              },
              {
                id: 'auto' as const,
                label: 'Act without asking',
                hint: 'Execute changes autonomously',
              },
            ] as const
          ).map((opt) => (
            <DropdownMenu.Item
              key={opt.id}
              onSelect={() => onChange(opt.id)}
              style={{ outline: 'none', cursor: 'pointer' }}
              className="hover:bg-accent focus:bg-accent transition-colors"
            >
              <div
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 14px' }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontFamily: LV.font.sans,
                      fontSize: 12.5,
                      color: LV.ink,
                      fontWeight: 500,
                    }}
                  >
                    {opt.label}
                  </div>
                  <div
                    style={{ fontFamily: LV.font.sans, fontSize: 11, color: LV.mute, marginTop: 1 }}
                  >
                    {opt.hint}
                  </div>
                </div>
                {actingMode === opt.id && (
                  <Check size={13} style={{ color: LV.gold, marginTop: 2, flexShrink: 0 }} />
                )}
              </div>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  mode: 'cowork' | 'code'
}

// ── Main component ────────────────────────────────────────────────────────────
export function DesktopSessionWindow({ mode }: Props) {
  const {
    sessionId,
    sessionMessages,
    setSessionMessages,
    streamingSet,
    scrollToBottomTick,
    user,
    selectedModel,
    setSelectedModel,
    effortMode,
    setEffortMode,
    sessionEffortModes,
    setSessionEffortMode,
    setSessionPrompt,
  } = useAppStore()

  const { send } = useStream()

  const [inputText, setInputText] = useState('')
  const [directory, setDirectory] = useState<string | null>(null)
  const [actingMode, setActingMode] = useState<'ask' | 'auto'>('ask')
  const [models, setModels] = useState<string[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isStreaming = streamingSet[sessionId ?? ''] === true
  const messages = sessionId ? (sessionMessages[sessionId] ?? []) : []
  const isHome = !sessionId
  const canSend = inputText.trim().length > 0 && !isStreaming

  // Load models once
  useEffect(() => {
    getModels()
      .then(({ models: ms }) => setModels(ms))
      .catch(() => {})
  }, [])

  // Load message history when session changes
  useEffect(() => {
    if (!sessionId) return
    if ((sessionMessages[sessionId] ?? []).length > 0) return
    setHistoryLoading(true)
    getAllChatMessages(sessionId)
      .then(({ messages: raw }) => {
        setSessionMessages(sessionId, raw.map(toStoreMessage))
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore per-session effort mode when the active session changes
  useEffect(() => {
    if (sessionId && sessionEffortModes[sessionId]) {
      setEffortMode(sessionEffortModes[sessionId])
    }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Change effort and persist it to the current session (if one is active). */
  const handleSelectEffort = useCallback(
    (e: 'low' | 'medium' | 'high') => {
      setEffortMode(e)
      if (sessionId) setSessionEffortMode(sessionId, e)
    },
    [sessionId, setEffortMode, setSessionEffortMode],
  )

  // Scroll to bottom on streaming ticks and new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, scrollToBottomTick])

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isStreaming) return
    const text = inputText
    setInputText('')

    // For auto acting mode: inject directive into the session prompt so the model
    // knows to act without asking.
    if (actingMode === 'auto') {
      const key = sessionId ?? '__new__'
      setSessionPrompt(
        key,
        'Act autonomously and execute changes directly without asking for confirmation. ' +
          'Do not pause to request approval before making file edits or running commands.',
      )
    }

    await send(text)
  }, [inputText, isStreaming, actingMode, sessionId, send, setSessionPrompt])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const greeting = getGreeting()
  const username = user?.username ?? 'there'
  const modeLabel = mode === 'cowork' ? 'Cowork' : 'Code'

  // ── Home screen ──────────────────────────────────────────────────────────
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
          background: LV.bg,
          backgroundImage: [
            'radial-gradient(ellipse 80% 60% at 50% 48%, rgba(168,140,80,0.09) 0%, transparent 60%)',
            'radial-gradient(ellipse 120% 80% at 50% 50%, rgba(140,118,72,0.05) 0%, transparent 70%)',
            'radial-gradient(circle at 50% 46%, rgba(200,168,106,0.03) 0%, transparent 40%)',
          ].join(', '),
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
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Mark size={44} />
          </div>
          <div
            style={{
              marginTop: 22,
              fontFamily: LV.font.display,
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: 38,
              letterSpacing: '-0.02em',
              color: LV.ink,
              lineHeight: 1.25,
            }}
          >
            {greeting}, {username}.
          </div>
          <div
            style={{
              marginTop: 14,
              fontFamily: LV.font.sans,
              fontWeight: 300,
              fontSize: 15.5,
              color: LV.soft,
            }}
          >
            {mode === 'cowork' ? 'What are you working on?' : 'Which codebase today?'}
          </div>
        </div>

        {/* Input box */}
        <div style={{ maxWidth: 680, width: '100%' }}>
          <div
            style={{
              background: LV.elev,
              border: `1px solid rgba(200,168,106,0.15)`,
              transition: 'border-color 0.2s',
            }}
          >
            {/* Textarea zone */}
            <div style={{ padding: '18px 20px 6px', position: 'relative' }}>
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 280)}px`
                }}
                onKeyDown={handleKeyDown}
                onFocus={(e) => {
                  e.currentTarget.closest('div')!.style.borderColor = 'rgba(200,168,106,0.28)'
                }}
                onBlur={(e) => {
                  e.currentTarget.closest('div')!.style.borderColor = 'rgba(200,168,106,0.15)'
                }}
                placeholder="Start a conversation, paste content, or describe what you need…"
                rows={3}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  fontFamily: LV.font.sans,
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: LV.ink,
                  caretColor: LV.gold,
                  minHeight: 56,
                }}
              />
            </div>

            {/* Toolbar + send */}
            <div
              style={{
                borderTop: `1px solid ${LV.rule}`,
                padding: '9px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <DirectoryChip directory={directory} onChange={setDirectory} />
              <ActingModeChip actingMode={actingMode} onChange={setActingMode} />
              <span style={{ flex: 1 }} />
              <ModelDropdown
                models={models}
                selectedModel={selectedModel}
                effortMode={effortMode}
                onSelectModel={setSelectedModel}
                onSelectEffort={handleSelectEffort}
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!canSend}
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  background: canSend ? LV.gold : LV.rule,
                  color: canSend ? LV.bg : LV.mute,
                  border: 'none',
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s',
                  borderRadius: 4,
                }}
              >
                <Send size={15} />
              </button>
            </div>
          </div>

          {/* Keyboard hints */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14, gap: 16 }}>
            <span style={{ fontFamily: LV.font.mono, fontSize: 9.5, color: LV.mute }}>↵ send</span>
            <span style={{ fontFamily: LV.font.mono, fontSize: 9.5, color: LV.mute }}>
              ⇧↵ newline
            </span>
            <span style={{ fontFamily: LV.font.mono, fontSize: 9.5, color: LV.mute }}>
              @ reference
            </span>
          </div>
        </div>
      </div>
    )
  }

  // ── Thread view ──────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: LV.bg,
      }}
    >
      {/* Conversation */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          justifyContent: 'center',
          padding: '28px 56px 0',
        }}
      >
        <div
          style={{
            maxWidth: 720,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            paddingBottom: 24,
          }}
        >
          {/* Thread header */}
          <div>
            <div
              style={{
                fontFamily: LV.font.mono,
                fontSize: 9.5,
                letterSpacing: '0.28em',
                textTransform: 'uppercase' as const,
                color: LV.gold,
              }}
            >
              {modeLabel} session
            </div>
            {directory && (
              <div style={{ marginTop: 6 }}>
                <span
                  style={{
                    fontFamily: LV.font.mono,
                    fontSize: 10.5,
                    color: LV.mute,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Folder size={11} style={{ color: LV.gold }} />
                  {directory}
                </span>
              </div>
            )}
          </div>

          {/* Loading indicator */}
          {historyLoading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: LV.mute,
                fontFamily: LV.font.mono,
                fontSize: 11,
              }}
            >
              <Loader2 size={11} className="animate-spin" />
              Loading…
            </div>
          )}

          {/* Messages */}
          {messages
            .filter((m) => m.role !== 'tool')
            .map((m, i, arr) => (
              <MessageRow key={m.id} msg={m} isLast={i === arr.length - 1 && isStreaming} />
            ))}
        </div>
      </div>

      {/* Input bar */}
      <div
        style={{
          borderTop: `1px solid ${LV.rule}`,
          padding: '0 56px',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div style={{ maxWidth: 720, width: '100%' }}>
          {/* Compose area */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 10,
              padding: '12px 0',
              borderBottom: `1px solid ${LV.ruleStrong}`,
            }}
          >
            <textarea
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`
              }}
              onKeyDown={handleKeyDown}
              placeholder="Reply, reference a file, or ask a question…"
              rows={1}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: LV.font.sans,
                fontSize: 14.5,
                lineHeight: 1.5,
                color: LV.ink,
                caretColor: LV.gold,
                paddingBottom: 3,
                minHeight: 26,
              }}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              style={{
                width: 28,
                height: 28,
                flexShrink: 0,
                background: canSend ? LV.gold : LV.rule,
                color: canSend ? LV.bg : LV.mute,
                border: 'none',
                cursor: canSend ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.15s',
                borderRadius: 4,
              }}
            >
              <Send size={14} />
            </button>
          </div>

          {/* Meta row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 0 14px',
            }}
          >
            <DirectoryChip directory={directory} onChange={setDirectory} />
            <ActingModeChip actingMode={actingMode} onChange={setActingMode} />
            <span style={{ fontFamily: LV.font.mono, fontSize: 9.5, color: LV.mute }}>⌘↵ send</span>
            <span style={{ fontFamily: LV.font.mono, fontSize: 9.5, color: LV.mute }}>
              @ reference
            </span>
            <span style={{ flex: 1 }} />
            <ModelDropdown
              models={models}
              selectedModel={selectedModel}
              effortMode={effortMode}
              onSelectModel={setSelectedModel}
              onSelectEffort={handleSelectEffort}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
