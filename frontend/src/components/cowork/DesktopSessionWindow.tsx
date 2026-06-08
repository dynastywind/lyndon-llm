// Shared home-screen + thread view used by both CoworkWindow and CodeWindow.
// Cowork and Code modes are desktop-only (guarded upstream by IS_TAURI check).

import { useCallback, useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Send,
  ChevronDown,
  Folder,
  FolderOpen,
  Check,
  Copy,
  RotateCcw,
  Square,
  Loader2,
  ShieldAlert,
  Github,
  GitBranch,
  Search,
  ArrowLeft,
  Lock,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { useStream } from '@/hooks/useStream'
import {
  getAllChatMessages,
  getModels,
  approveToolCall,
  rejectToolCall,
  getGithubConnectUrl,
  getGithubRepos,
  getGithubBranches,
  cloneRepo,
  checkoutBranch,
  pullRepo,
  getRepoStatus,
} from '@/api/client'
import type { GithubRepo, GithubBranch, RepoStatus } from '@/api/client'
import type { Message, ChatSessionMessage, ToolCallRecord } from '@/types'
import { cn } from '@/lib/utils'
import { MicButton } from '@/components/chat/MicButton'

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
  if (h >= 5 && h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Night owl'
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

// ── Copy button (hover action on message bubbles) ─────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const [hover, setHover] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copied' : 'Copy'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        lineHeight: 0,
        display: 'flex',
        alignItems: 'center',
        color: copied ? LV.gold : hover ? LV.ink : LV.mute,
        transition: 'color 0.2s var(--ease-snap)',
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

// ── Rerun button (re-sends the bubble content as a fresh message) ──────────────
function RerunButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Rerun"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        padding: 4,
        lineHeight: 0,
        display: 'flex',
        alignItems: 'center',
        opacity: disabled ? 0.4 : 1,
        color: !disabled && hover ? LV.ink : LV.mute,
        transition: 'color 0.2s var(--ease-snap)',
      }}
    >
      <RotateCcw size={13} />
    </button>
  )
}

// ── User message bubble (hover reveals rerun + copy actions) ──────────────────
function UserBubble({
  content,
  onRerun,
  rerunDisabled,
}: {
  content: string
  onRerun: (content: string) => void
  rerunDisabled: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
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
        {content}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: -2,
          marginRight: -4,
          opacity: hover ? 1 : 0,
          transform: hover ? 'translateY(0)' : 'translateY(-3px)',
          pointerEvents: hover ? 'auto' : 'none',
          transition: 'opacity 0.2s var(--ease-snap), transform 0.2s var(--ease-snap)',
        }}
      >
        <RerunButton onClick={() => onRerun(content)} disabled={rerunDisabled} />
        <CopyButton text={content} />
      </div>
    </div>
  )
}

// ── Message row ───────────────────────────────────────────────────────────────
function MessageRow({
  msg,
  isLast,
  onRerun,
  rerunDisabled,
}: {
  msg: Message
  isLast: boolean
  onRerun: (content: string) => void
  rerunDisabled: boolean
}) {
  if (msg.role === 'tool') return null

  if (msg.role === 'user') {
    return <UserBubble content={msg.content} onRerun={onRerun} rerunDisabled={rerunDisabled} />
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

// ── GitHub repo dropdown (code mode) ──────────────────────────────────────────

/** Start an OAuth flow by navigating the webview to the provider URL.
 * Matches the login flow (LoginDialog uses `window.location.href`); the backend
 * redirects back to the app afterward. */
function openExternal(url: string) {
  window.location.href = url
}

const CHIP_BTN: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  border: `1px solid ${LV.rule}`,
  padding: '5px 12px 5px 8px',
  cursor: 'pointer',
  borderRadius: 999,
  transition: 'all 0.18s',
}

// ── Folder picker (Tauri dialog, lazy-loaded — desktop only) ──────────────────
async function pickFolder(defaultPath?: string): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select directory',
      ...(defaultPath?.startsWith('/') ? { defaultPath } : {}),
    })
    return typeof selected === 'string' ? selected : null
  } catch (err) {
    console.warn('[directory] folder picker failed:', err)
    return null
  }
}

function relativeUpdated(iso: string | null): string {
  if (!iso) return 'recently'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

const CHIP_EYEBROW: React.CSSProperties = {
  fontFamily: LV.font.mono,
  fontSize: 9,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: LV.mute,
}
const CLONE_BTN: React.CSSProperties = {
  width: '100%',
  background: LV.gold,
  color: LV.bg,
  border: 'none',
  cursor: 'pointer',
  padding: '9px 0',
  fontFamily: LV.font.sans,
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: '0.04em',
  transition: 'background 0.18s var(--ease-snap)',
}
const GHOST_BTN: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  color: LV.soft,
  border: `1px solid ${LV.rule}`,
  cursor: 'pointer',
  padding: '6px 0',
  fontFamily: LV.font.mono,
  fontSize: 10.5,
  letterSpacing: '0.04em',
  borderRadius: 999,
}

function DropMsg({ text }: { text: string }) {
  return (
    <div style={{ padding: '10px 14px', fontFamily: LV.font.mono, fontSize: 11, color: LV.mute }}>
      {text}
    </div>
  )
}

// Reusable dropdown row (icon + title + sub + right slot), hover-highlighted.
function GhRow({
  left,
  title,
  sub,
  right,
  mono,
  onClick,
}: {
  left?: React.ReactNode
  title: string
  sub?: string
  right?: React.ReactNode
  mono?: boolean
  onClick?: () => void
}) {
  const [h, setH] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        cursor: 'pointer',
        background: h ? LV.wash : 'transparent',
        transition: 'background 0.15s var(--ease-snap)',
      }}
    >
      {left && (
        <span style={{ color: h ? LV.gold : LV.mute, lineHeight: 0, flex: 'none' }}>{left}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: mono ? LV.font.mono : LV.font.sans,
            fontSize: mono ? 11.5 : 12.5,
            color: LV.ink,
            fontWeight: 500,
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
        {sub && (
          <div style={{ fontFamily: LV.font.mono, fontSize: 10, color: LV.mute, marginTop: 2 }}>
            {sub}
          </div>
        )}
      </div>
      {right && <span style={{ flex: 'none', lineHeight: 0 }}>{right}</span>}
    </div>
  )
}

function WizHeader({ label, onBack }: { label: string; onBack: () => void }) {
  const [h, setH] = useState(false)
  return (
    <div
      onClick={onBack}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 12px 9px',
        cursor: 'pointer',
      }}
    >
      <span style={{ color: h ? LV.gold : LV.mute, lineHeight: 0 }}>
        <ArrowLeft size={13} />
      </span>
      <span style={CHIP_EYEBROW}>{label}</span>
    </div>
  )
}

// ── Directory / GitHub selector (replaces the plain directory button) ─────────
// Unified chip: pick a local dir, or connect a GitHub repo (account → repo →
// branch → clone-to → clone). Once on a git repo, shows live branch + status.
type WizStep = 'account' | 'repo' | 'branch' | 'dir' | 'cloning'

function CWGitDirectory({
  directory,
  repo,
  status,
  allowGithub,
  onPickLocal,
  onClone,
  onCheckout,
  onPull,
  onDisconnect,
}: {
  directory: string | null
  repo: string | null
  status: RepoStatus | null
  allowGithub: boolean // GitHub association is a Code-mode feature; cowork is dir-only
  onPickLocal: (path: string) => void
  onClone: (r: GithubRepo, branch: string | undefined, targetDir: string) => Promise<void>
  onCheckout: (branch: string) => Promise<void>
  onPull: () => Promise<void>
  onDisconnect: () => void
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<WizStep | null>(null)
  const [allRepos, setAllRepos] = useState<GithubRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [account, setAccount] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selRepo, setSelRepo] = useState<GithubRepo | null>(null)
  const [selBranch, setSelBranch] = useState<string | null>(null)
  const [branches, setBranches] = useState<GithubBranch[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [parent, setParent] = useState<string>(COMMON_DIRS[0])
  const [progress, setProgress] = useState(0)
  const [cloneErr, setCloneErr] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [pulling, setPulling] = useState(false)

  const isGit = status?.is_repo === true && allowGithub
  const s = status?.status
  const changed = s ? s.modified.length + s.staged.length + s.untracked.length : 0
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const dirty = changed > 0 || ahead > 0 || behind > 0
  const repoShort = repo ? repo.split('/').slice(-1)[0] : null

  // Reset transient wizard state whenever the popover closes.
  useEffect(() => {
    if (!open) {
      setStep(null)
      setQuery('')
      setCloneErr(null)
      setSwitching(false)
    }
  }, [open])

  // Clone: animate the bar toward 90% while the real clone runs, finish at 100%.
  useEffect(() => {
    if (step !== 'cloning' || !selRepo) return
    setProgress(0)
    setCloneErr(null)
    let p = 0
    let finished = false
    const target = `${parent}/${selRepo.full_name.split('/').slice(-1)[0]}`
    const iv = setInterval(() => {
      if (finished) return
      p = Math.min(90, p + Math.random() * 13 + 7)
      setProgress(p)
    }, 230)
    void (async () => {
      try {
        await onClone(selRepo, selBranch ?? undefined, target)
        finished = true
        clearInterval(iv)
        setProgress(100)
        setTimeout(() => setOpen(false), 650)
      } catch (e) {
        finished = true
        clearInterval(iv)
        setCloneErr(e instanceof Error ? e.message : 'Clone failed')
      }
    })()
    return () => clearInterval(iv)
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const startWizard = () => {
    setLoadingRepos(true)
    setQuery('')
    setAccount(null)
    setStep('account')
    void (async () => {
      try {
        const r = await getGithubRepos()
        if (!r.connected) {
          const { url } = await getGithubConnectUrl()
          openExternal(url) // navigates to GitHub OAuth; user re-opens after authorizing
          return
        }
        setAllRepos(r.repos)
        const owners = [...new Set(r.repos.map((x) => x.full_name.split('/')[0]))]
        if (owners.length === 1) {
          setAccount(owners[0])
          setStep('repo')
        }
      } catch (err) {
        console.warn('[github] repo list failed:', err)
      } finally {
        setLoadingRepos(false)
      }
    })()
  }

  const loadBranches = (repoFullName: string) => {
    setLoadingBranches(true)
    setBranches([])
    void (async () => {
      try {
        const b = await getGithubBranches(repoFullName)
        setBranches(b.branches)
      } catch {
        setBranches([])
      } finally {
        setLoadingBranches(false)
      }
    })()
  }

  const pickRepo = (r: GithubRepo) => {
    setSelRepo(r)
    setSelBranch(null)
    setSwitching(false)
    setStep('branch')
    loadBranches(r.full_name)
  }

  const openBranchSwitch = () => {
    if (!repo) return
    setSwitching(true)
    setStep('branch')
    loadBranches(repo)
  }

  const doPull = () => {
    setPulling(true)
    void (async () => {
      try {
        await onPull()
      } finally {
        setPulling(false)
      }
    })()
  }

  // ── Chip face ───────────────────────────────────────────────────────────────
  const chip = (() => {
    if (!directory) {
      return (
        <>
          <span style={{ color: open ? LV.gold : LV.mute, lineHeight: 0 }}>
            <Folder size={13} />
          </span>
          <span
            style={{
              ...CHIP_EYEBROW,
              fontSize: 11,
              letterSpacing: '0.02em',
              textTransform: 'none',
            }}
          >
            Set directory
          </span>
          <ChevronDown size={11} style={{ color: LV.mute, flexShrink: 0 }} />
        </>
      )
    }
    if (!isGit) {
      return (
        <>
          <span style={{ color: open ? LV.gold : LV.soft, lineHeight: 0 }}>
            <Folder size={13} />
          </span>
          <span
            style={{
              fontFamily: LV.font.mono,
              fontSize: 11,
              color: LV.soft,
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {directory}
          </span>
          <ChevronDown size={11} style={{ color: LV.mute, flexShrink: 0 }} />
        </>
      )
    }
    return (
      <>
        <span style={{ color: dirty ? LV.gold : LV.soft, lineHeight: 0 }}>
          <GitBranch size={13} />
        </span>
        <span style={{ fontFamily: LV.font.mono, fontSize: 11, color: LV.soft }}>
          {repoShort ?? directory.split('/').slice(-1)[0]}
        </span>
        <span style={{ width: 1, height: 11, background: LV.rule, flex: 'none' }} />
        <span style={{ fontFamily: LV.font.mono, fontSize: 11, color: LV.soft }}>
          {status?.branch ?? '—'}
        </span>
        {dirty ? (
          <span style={{ fontFamily: LV.font.mono, fontSize: 10.5, color: LV.mute }}>
            ↑{ahead} ↓{behind} <span style={{ color: LV.gold }}>· {changed} changed</span>
          </span>
        ) : (
          <span style={{ fontFamily: LV.font.mono, fontSize: 10.5, color: LV.mute }}>✓ clean</span>
        )}
        <ChevronDown size={11} style={{ color: LV.mute, flexShrink: 0 }} />
      </>
    )
  })()

  // ── Dropdown body ─────────────────────────────────────────────────────────
  let body: React.ReactNode
  if (step === 'account') {
    const owners = [...new Set(allRepos.map((r) => r.full_name.split('/')[0]))]
    body = (
      <>
        <WizHeader label="Connect repo · Account" onBack={() => setStep(null)} />
        {loadingRepos ? (
          <DropMsg text="Loading…" />
        ) : (
          owners.map((o) => (
            <GhRow
              key={o}
              left={<Github size={16} />}
              title={o}
              sub={`${allRepos.filter((r) => r.full_name.split('/')[0] === o).length} repos`}
              right={
                <ChevronDown size={12} style={{ color: LV.mute, transform: 'rotate(-90deg)' }} />
              }
              onClick={() => {
                setAccount(o)
                setQuery('')
                setStep('repo')
              }}
            />
          ))
        )}
      </>
    )
  } else if (step === 'repo') {
    const list = allRepos
      .filter((r) => r.full_name.split('/')[0] === account)
      .filter((r) => r.full_name.toLowerCase().includes(query.trim().toLowerCase()))
    body = (
      <>
        <WizHeader label={`${account} · Repository`} onBack={() => setStep('account')} />
        <div style={{ padding: '0 12px 6px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              border: `1px solid ${LV.rule}`,
              borderRadius: 999,
              padding: '5px 12px',
            }}
          >
            <Search size={13} style={{ color: LV.mute, flexShrink: 0 }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search repositories…"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: LV.ink,
                fontFamily: LV.font.mono,
                fontSize: 11,
              }}
            />
          </div>
        </div>
        {list.length ? (
          list.map((r) => (
            <GhRow
              key={r.full_name}
              mono
              left={<Github size={15} />}
              title={r.full_name.split('/').slice(-1)[0]}
              sub={`updated ${relativeUpdated(r.updated_at)}`}
              right={r.private ? <Lock size={12} style={{ color: LV.mute }} /> : null}
              onClick={() => pickRepo(r)}
            />
          ))
        ) : (
          <DropMsg text="No repositories match." />
        )}
      </>
    )
  } else if (step === 'branch') {
    const repoName = selRepo ? selRepo.full_name.split('/').slice(-1)[0] : repoShort
    body = (
      <>
        <WizHeader
          label={`${repoName} · Branch`}
          onBack={() => setStep(switching ? null : 'repo')}
        />
        {loadingBranches ? (
          <DropMsg text="Loading…" />
        ) : branches.length ? (
          branches.map((b) => (
            <GhRow
              key={b.name}
              mono
              left={<GitBranch size={14} />}
              title={b.name}
              sub={b.default ? 'default' : undefined}
              right={
                switching && status?.branch === b.name ? (
                  <Check size={14} style={{ color: LV.gold }} />
                ) : null
              }
              onClick={() => {
                if (switching) {
                  void onCheckout(b.name)
                  setStep(null)
                  setSwitching(false)
                } else {
                  setSelBranch(b.name)
                  setStep('dir')
                }
              }}
            />
          ))
        ) : (
          <DropMsg text="No branches." />
        )}
      </>
    )
  } else if (step === 'dir' && selRepo) {
    const repoName = selRepo.full_name.split('/').slice(-1)[0]
    body = (
      <>
        <WizHeader
          label={`${repoName} · ${selBranch} · Clone to`}
          onBack={() => setStep('branch')}
        />
        {COMMON_DIRS.map((p) => (
          <GhRow
            key={p}
            mono
            title={`${p}/${repoName}`}
            sub={p === parent ? 'clone target' : 'parent directory'}
            right={p === parent ? <Check size={14} style={{ color: LV.gold }} /> : null}
            onClick={() => setParent(p)}
          />
        ))}
        <GhRow
          left={<FolderOpen size={15} />}
          title="Browse…"
          sub="Choose a parent folder"
          onClick={() =>
            void (async () => {
              const picked = await pickFolder()
              if (picked) setParent(picked)
            })()
          }
        />
        <div style={{ padding: '8px 12px' }}>
          <button
            type="button"
            onClick={() => setStep('cloning')}
            style={CLONE_BTN}
            onMouseEnter={(e) => (e.currentTarget.style.background = LV.goldSoft)}
            onMouseLeave={(e) => (e.currentTarget.style.background = LV.gold)}
          >
            Clone repository →
          </button>
        </div>
      </>
    )
  } else if (step === 'cloning' && selRepo) {
    const pct = Math.round(progress)
    const repoName = selRepo.full_name.split('/').slice(-1)[0]
    const target = `${parent}/${repoName}`
    body = (
      <>
        <div style={{ padding: '7px 12px 8px' }}>
          <span style={{ ...CHIP_EYEBROW, color: LV.gold }}>Cloning · {repoName}</span>
        </div>
        <div
          style={{
            padding: '0 12px 8px',
            fontFamily: LV.font.mono,
            fontSize: 10.5,
            lineHeight: 1.75,
          }}
        >
          <div
            style={{
              color: LV.mute,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            $ git clone {selRepo.clone_url}
          </div>
          <div style={{ color: LV.soft }}>Cloning into &apos;{repoName}&apos;…</div>
          {progress > 30 && (
            <div style={{ color: LV.soft }}>remote: Enumerating objects, done.</div>
          )}
          {progress > 60 && <div style={{ color: LV.soft }}>Receiving objects: {pct}%</div>}
          {progress >= 100 && <div style={{ color: LV.gold }}>✓ Cloned to {target}</div>}
          {cloneErr && <div style={{ color: '#dc2626' }}>✗ {cloneErr}</div>}
        </div>
        <div style={{ padding: '2px 12px 12px' }}>
          <div style={{ height: 3, background: LV.rule, borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                background: cloneErr ? '#dc2626' : LV.gold,
                transition: 'width 0.22s linear',
              }}
            />
          </div>
        </div>
        {cloneErr && (
          <div style={{ padding: '0 12px 10px' }}>
            <button type="button" onClick={() => setStep('dir')} style={GHOST_BTN}>
              Back
            </button>
          </div>
        )}
      </>
    )
  } else if (isGit) {
    body = (
      <>
        <div style={{ padding: '9px 12px 6px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ color: LV.soft, lineHeight: 0 }}>
            <Github size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: LV.font.mono,
                fontSize: 11.5,
                color: LV.ink,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {repo ?? repoShort ?? 'Repository'}
            </div>
            <div
              style={{
                fontFamily: LV.font.mono,
                fontSize: 10,
                color: LV.mute,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {directory}
            </div>
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${LV.rule}`, margin: '4px 0' }} />
        <GhRow
          mono
          left={<GitBranch size={14} />}
          title={status?.branch ?? '—'}
          sub="current branch · switch"
          right={<ChevronDown size={12} style={{ color: LV.mute }} />}
          onClick={openBranchSwitch}
        />
        <div style={{ padding: '8px 12px 4px' }}>
          <span style={CHIP_EYEBROW}>Status</span>
          <div
            style={{
              fontFamily: LV.font.mono,
              fontSize: 10.5,
              color: LV.soft,
              lineHeight: 1.7,
              marginTop: 6,
            }}
          >
            {dirty ? (
              <>
                ↑{ahead} ahead · ↓{behind} behind ·{' '}
                <span style={{ color: LV.gold }}>{changed} uncommitted</span>
              </>
            ) : (
              <span style={{ color: LV.mute }}>
                Working tree clean · up to date with origin/{status?.branch}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '10px 12px' }}>
          <button type="button" onClick={doPull} disabled={pulling} style={GHOST_BTN}>
            {pulling ? 'Pulling…' : 'Pull'}
          </button>
          <button
            type="button"
            onClick={() => {
              onDisconnect()
              setOpen(false)
            }}
            style={GHOST_BTN}
          >
            Disconnect
          </button>
        </div>
      </>
    )
  } else {
    body = (
      <>
        <div style={{ ...CHIP_EYEBROW, padding: '7px 12px 6px' }}>Work directory</div>
        {COMMON_DIRS.map((d) => (
          <GhRow
            key={d}
            mono
            title={d}
            right={d === directory ? <Check size={14} style={{ color: LV.gold }} /> : null}
            onClick={() => {
              onPickLocal(d)
              setOpen(false)
            }}
          />
        ))}
        <GhRow
          left={<FolderOpen size={15} />}
          title="Browse…"
          sub="Choose a folder"
          onClick={() =>
            void (async () => {
              const picked = await pickFolder(directory ?? undefined)
              if (picked) {
                onPickLocal(picked)
                setOpen(false)
              }
            })()
          }
        />
        {allowGithub && (
          <>
            <div style={{ borderTop: `1px solid ${LV.rule}`, margin: '4px 0' }} />
            <GhRow
              left={<Github size={16} />}
              title="Connect GitHub repo"
              sub="Clone & track a repository"
              onClick={startWizard}
            />
          </>
        )}
      </>
    )
  }

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...CHIP_BTN,
          background: directory ? LV.wash : 'transparent',
          border: `1px solid ${open ? LV.ruleStrong : LV.rule}`,
          whiteSpace: 'nowrap',
        }}
      >
        {chip}
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: 0,
              width: 304,
              zIndex: 200,
              background: 'var(--lv-card)',
              border: `1px solid ${LV.ruleStrong}`,
              borderRadius: 8,
              padding: '4px 0',
              boxShadow: LV.shadow,
              maxHeight: 380,
              overflowY: 'auto',
            }}
          >
            {body}
          </div>
        </>
      )}
    </div>
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
    sessionDirectories,
    setSessionDirectory,
    sessionRepos,
    setSessionRepo,
    sessionActingModes,
    setSessionActingMode,
    setSessionPrompt,
    pendingToolApproval,
    setPendingToolApproval,
  } = useAppStore()

  const { send, stop } = useStream()

  const [inputText, setInputText] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  // Live git status of the work directory (code mode only)
  const [gitStatus, setGitStatus] = useState<RepoStatus | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isStreaming = streamingSet[sessionId ?? ''] === true
  const messages = sessionId ? (sessionMessages[sessionId] ?? []) : []
  const isHome = !sessionId
  const canSend = inputText.trim().length > 0 && !isStreaming

  // Insert transcribed speech into the input, appended to whatever is typed.
  const appendTranscript = (text: string) => {
    setInputText((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // Working directory and acting mode are remembered per thread: keyed by
  // sessionId once the thread exists, or under '__new__' while still on the home
  // screen (carried onto the real session by useStream when the first message
  // creates it).
  const directory = sessionDirectories[sessionId ?? '__new__'] ?? null
  const repo = sessionRepos[sessionId ?? '__new__'] ?? null
  const actingMode = sessionActingModes[sessionId ?? '__new__'] ?? 'ask'

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

  /** Pick an acting mode and remember it for this thread. */
  const handleSelectActingMode = useCallback(
    (m: 'ask' | 'auto') => {
      setSessionActingMode(sessionId ?? '__new__', m)
    },
    [sessionId, setSessionActingMode],
  )

  /** Fetch git status for the current work directory (code mode only). */
  const refreshGitStatus = useCallback(async () => {
    if (mode !== 'code' || !directory) {
      setGitStatus(null)
      return
    }
    try {
      setGitStatus(await getRepoStatus(directory))
    } catch {
      setGitStatus(null)
    }
  }, [mode, directory])

  // Refresh git status when the directory changes, and after each assistant turn
  // finishes (the agent may have edited files in the repo).
  useEffect(() => {
    void refreshGitStatus()
  }, [refreshGitStatus])

  const prevStreaming = useRef(isStreaming)
  useEffect(() => {
    if (prevStreaming.current && !isStreaming) void refreshGitStatus()
    prevStreaming.current = isStreaming
  }, [isStreaming, refreshGitStatus])

  /** Pick a plain local directory (clears any tracked repo). */
  const handlePickLocal = useCallback(
    (path: string) => {
      const key = sessionId ?? '__new__'
      setSessionDirectory(key, path)
      setSessionRepo(key, null)
    },
    [sessionId, setSessionDirectory, setSessionRepo],
  )

  /** Clone a repo into targetDir, then track it as this thread's work directory. */
  const handleClone = useCallback(
    async (r: GithubRepo, branch: string | undefined, targetDir: string) => {
      await cloneRepo(r.clone_url, targetDir, branch)
      const key = sessionId ?? '__new__'
      setSessionDirectory(key, targetDir)
      setSessionRepo(key, r.full_name)
      await refreshGitStatus()
    },
    [sessionId, setSessionDirectory, setSessionRepo, refreshGitStatus],
  )

  /** Switch branches in the cloned repo. */
  const handleCheckout = useCallback(
    async (branch: string) => {
      if (!directory) return
      await checkoutBranch(directory, branch)
      await refreshGitStatus()
    },
    [directory, refreshGitStatus],
  )

  /** Pull the current branch. */
  const handlePull = useCallback(async () => {
    if (!directory) return
    await pullRepo(directory)
    await refreshGitStatus()
  }, [directory, refreshGitStatus])

  /** Stop tracking the repo/directory for this thread (does not delete files). */
  const handleDisconnect = useCallback(() => {
    const key = sessionId ?? '__new__'
    setSessionDirectory(key, null)
    setSessionRepo(key, null)
    setGitStatus(null)
  }, [sessionId, setSessionDirectory, setSessionRepo])

  // Scroll to bottom on streaming ticks and new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, scrollToBottomTick])

  // Send a message — same path whether typed into the input or re-run from a bubble.
  const submitMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return

      // For auto acting mode: inject directive into the session prompt so the model
      // knows to act without asking for confirmation at the language level.
      if (actingMode === 'auto') {
        const key = sessionId ?? '__new__'
        setSessionPrompt(
          key,
          'Act autonomously and execute changes directly without asking for confirmation. ' +
            'Do not pause to request approval before making file edits or running commands.',
        )
      }

      await send(text, undefined, undefined, undefined, undefined, {
        requireToolApproval: actingMode === 'ask',
      })
    },
    [isStreaming, actingMode, sessionId, send, setSessionPrompt],
  )

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isStreaming) return
    const text = inputText
    setInputText('')
    await submitMessage(text)
  }, [inputText, isStreaming, submitMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const greeting = getGreeting()
  const username = user?.username ?? 'there'
  const modeLabel = mode === 'cowork' ? 'Cowork' : 'Code'

  // ── Tool approval handlers ────────────────────────────────────────────────
  const approval =
    pendingToolApproval && pendingToolApproval.sessionId === sessionId ? pendingToolApproval : null

  const handleApprove = useCallback(async () => {
    if (!approval) return
    setPendingToolApproval(null)
    await approveToolCall(approval.sessionId, approval.callId)
  }, [approval, setPendingToolApproval])

  const handleReject = useCallback(async () => {
    if (!approval) return
    setPendingToolApproval(null)
    await rejectToolCall(approval.sessionId, approval.callId)
  }, [approval, setPendingToolApproval])

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
              borderRadius: 12,
              overflow: 'hidden',
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
              <CWGitDirectory
                directory={directory}
                repo={repo}
                status={gitStatus}
                allowGithub={mode === 'code'}
                onPickLocal={handlePickLocal}
                onClone={handleClone}
                onCheckout={handleCheckout}
                onPull={handlePull}
                onDisconnect={handleDisconnect}
              />
              <ActingModeChip actingMode={actingMode} onChange={handleSelectActingMode} />
              <span style={{ flex: 1 }} />
              <ModelDropdown
                models={models}
                selectedModel={selectedModel}
                effortMode={effortMode}
                onSelectModel={setSelectedModel}
                onSelectEffort={handleSelectEffort}
              />
              <MicButton
                onTranscript={appendTranscript}
                disabled={isStreaming}
                variant="square"
                size={32}
                radius={4}
              />
              <button
                type="button"
                onClick={() => (isStreaming ? stop(sessionId ?? '') : void handleSend())}
                disabled={isStreaming ? false : !canSend}
                title={isStreaming ? 'Stop' : undefined}
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  background: canSend || isStreaming ? LV.gold : LV.rule,
                  color: canSend || isStreaming ? LV.bg : LV.mute,
                  border: 'none',
                  cursor: canSend || isStreaming ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s',
                  borderRadius: 4,
                }}
              >
                {isStreaming ? <Square size={15} fill="currentColor" /> : <Send size={15} />}
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
        flex: 1,
        minHeight: 0,
        background: LV.bg,
        position: 'relative',
      }}
    >
      {/* ── Tool approval dialog ─────────────────────────────────────────── */}
      {approval && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 300,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              background: 'var(--lv-card)',
              border: `1px solid ${LV.ruleStrong}`,
              borderRadius: 12,
              padding: '28px 32px',
              width: 480,
              maxWidth: 'calc(100vw - 48px)',
              boxShadow: LV.shadow,
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <ShieldAlert size={18} style={{ color: LV.gold, flexShrink: 0 }} />
              <div>
                <div
                  style={{
                    fontFamily: LV.font.mono,
                    fontSize: 9,
                    letterSpacing: '0.28em',
                    textTransform: 'uppercase' as const,
                    color: LV.gold,
                    marginBottom: 3,
                  }}
                >
                  Permission required
                </div>
                <div
                  style={{
                    fontFamily: LV.font.sans,
                    fontSize: 15,
                    fontWeight: 600,
                    color: LV.ink,
                  }}
                >
                  Allow tool call?
                </div>
              </div>
            </div>

            {/* Tool info */}
            <div
              style={{
                background: LV.washSoft,
                border: `1px solid ${LV.rule}`,
                borderRadius: 6,
                padding: '12px 16px',
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  fontFamily: LV.font.mono,
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase' as const,
                  color: LV.mute,
                  marginBottom: 6,
                }}
              >
                Tool · {approval.toolName}
              </div>
              {Object.keys(approval.args).length > 0 && (
                <pre
                  style={{
                    fontFamily: LV.font.mono,
                    fontSize: 11.5,
                    color: LV.soft,
                    whiteSpace: 'pre-wrap' as const,
                    wordBreak: 'break-all' as const,
                    margin: 0,
                    maxHeight: 160,
                    overflowY: 'auto',
                  }}
                >
                  {JSON.stringify(approval.args, null, 2)}
                </pre>
              )}
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => void handleReject()}
                style={{
                  padding: '8px 20px',
                  background: 'transparent',
                  border: `1px solid ${LV.ruleStrong}`,
                  borderRadius: 6,
                  fontFamily: LV.font.sans,
                  fontSize: 13,
                  color: LV.soft,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => void handleApprove()}
                style={{
                  padding: '8px 24px',
                  background: LV.gold,
                  border: 'none',
                  borderRadius: 6,
                  fontFamily: LV.font.sans,
                  fontSize: 13,
                  fontWeight: 600,
                  color: LV.bg,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
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
              <MessageRow
                key={m.id}
                msg={m}
                isLast={i === arr.length - 1 && isStreaming}
                onRerun={(text) => void submitMessage(text)}
                rerunDisabled={isStreaming}
              />
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
            <MicButton
              onTranscript={appendTranscript}
              disabled={isStreaming}
              variant="square"
              size={28}
              radius={4}
            />
            <button
              type="button"
              onClick={() => (isStreaming ? stop(sessionId ?? '') : void handleSend())}
              disabled={isStreaming ? false : !canSend}
              title={isStreaming ? 'Stop' : undefined}
              style={{
                width: 28,
                height: 28,
                flexShrink: 0,
                background: canSend || isStreaming ? LV.gold : LV.rule,
                color: canSend || isStreaming ? LV.bg : LV.mute,
                border: 'none',
                cursor: canSend || isStreaming ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.15s',
                borderRadius: 4,
              }}
            >
              {isStreaming ? <Square size={14} fill="currentColor" /> : <Send size={14} />}
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
            <CWGitDirectory
              directory={directory}
              repo={repo}
              status={gitStatus}
              allowGithub={mode === 'code'}
              onPickLocal={handlePickLocal}
              onClone={handleClone}
              onCheckout={handleCheckout}
              onPull={handlePull}
              onDisconnect={handleDisconnect}
            />
            <ActingModeChip actingMode={actingMode} onChange={handleSelectActingMode} />
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
