import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  BookOpen,
  Puzzle,
  Server,
  Trash2,
  Loader2,
  Pencil,
  Pin,
  MessageSquare,
  MoreHorizontal,
  MessageSquarePlus,
  UserCircle,
  Search,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useChatHistory } from '@/hooks/useChatHistory'
import {
  deleteChatSession,
  getAvatarUrl,
  renameChatSession,
  searchChatSessions,
} from '@/api/client'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import { LoginDialog } from '@/components/auth/LoginDialog'
import { DeleteAccountDialog } from '@/components/auth/DeleteAccountDialog'
import { ThemeToggle } from './ThemeToggle'
import type { Mode, ChatSession } from '@/types'

// ── Lyndon Vision palette (local constants matching CSS vars) ─────────────────
const LV = {
  bg: 'var(--lv-bg)',
  elev: 'var(--lv-elev)',
  ink: 'var(--lv-ink)',
  soft: 'var(--lv-soft)',
  mute: 'var(--lv-mute)',
  rule: 'var(--lv-rule)',
  gold: 'var(--lv-gold)',
  font: {
    sans: 'var(--font-sans)',
    display: 'var(--font-display)',
    mono: 'var(--font-mono)',
  },
}

// ── helpers ───────────────────────────────────────────────────────────────────
function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d`
  return new Date(isoString).toLocaleDateString()
}

// ── Mark — static asterisk logo (logo-asterisk.svg geometry, currentColor) ───
function Mark({ size = 22 }: { size?: number }) {
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

// ── Animated asterisk (sidebar session rows while streaming) ──────────────────
function SidebarAsteriskAnimated({ size = 12 }: { size?: number }) {
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
      style={{ flex: 'none', color: 'var(--lv-gold)' }}
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

// ── Environment detection ─────────────────────────────────────────────────────
const IS_TAURI =
  typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'

// ── Modes (desktop-only — web is chat-only with no tab group) ─────────────────
const DESKTOP_MODES: { id: Mode; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'cowork', label: 'Cowork' },
  { id: 'code', label: 'Code' },
]

// ── SectionLabel ──────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '6px 16px 2px',
        fontFamily: LV.font.mono,
        fontSize: 9.5,
        letterSpacing: '0.28em',
        textTransform: 'uppercase',
        color: LV.mute,
        fontWeight: 500,
      }}
    >
      {children}
    </div>
  )
}

// ── component ─────────────────────────────────────────────────────────────────
export function Sidebar() {
  const {
    mode,
    setMode,
    sessionId,
    setSessionId,
    setSessionTitle,
    clearSessionMessages,
    streamingSet,
    bumpSessionVersion,
    sessionPrompts,
    setSessionPrompt,
    user,
    logout,
    pendingOAuthToken,
    setPendingOAuthToken,
    avatarVersion,
    pinnedSessionIds,
    pinSession,
    unpinSession,
  } = useAppStore()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)

  // Auto-open LoginDialog in oauth-username mode when App detects a pending OAuth token
  useEffect(() => {
    if (pendingOAuthToken) setLoginOpen(true)
  }, [pendingOAuthToken])
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile')

  // Session prompt modal
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const promptInputRef = useRef<HTMLTextAreaElement>(null)

  // Search
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<(ChatSession & { snippet?: string })[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // The key for the current session prompt slot
  const promptKey = sessionId ?? '__new__'
  const currentSessionPrompt = sessionPrompts[promptKey] ?? ''

  // Focus textarea when modal opens
  useEffect(() => {
    if (promptOpen) {
      setPromptDraft(currentSessionPrompt)
      setTimeout(() => promptInputRef.current?.focus(), 30)
    }
  }, [promptOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromptConfirm = () => {
    setSessionPrompt(promptKey, promptDraft.trim())
    setPromptOpen(false)
  }

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }

  const { sessions, loading, loadingMore, hasMore, sentinelRef, removeSession } = useChatHistory(
    mode === 'sandbox' ? 'chat' : mode,
  )

  useEffect(() => {
    if (!sessionId) return
    const current = sessions.find((s) => s.session_id === sessionId)
    if (current) setSessionTitle(current.title)
  }, [sessions, sessionId, setSessionTitle])

  // Web is chat-only — reset any persisted desktop mode value
  useEffect(() => {
    if (!IS_TAURI && mode !== 'chat') setMode('chat')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Search: reset when closed; auto-focus when opened
  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery('')
      setSearchResults([])
    } else {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [searchOpen])

  // Search: debounced query → backend
  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([])
      return
    }
    setSearchLoading(true)
    const t = setTimeout(async () => {
      try {
        const data = await searchChatSessions(mode === 'chat' ? 'chat' : 'code', searchQuery.trim())
        setSearchResults(data.sessions)
      } catch {
        // ignore network errors silently
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [searchQuery, searchOpen, mode])

  const handleNewChat = () => {
    if (!sessionId) return
    setSessionId(null)
    setSessionTitle(null)
  }

  /** Switch mode and reset the active session so the new mode shows its home screen. */
  const handleModeChange = (newMode: Mode) => {
    if (newMode === mode) return
    setMode(newMode)
    setSessionId(null)
    setSessionTitle(null)
  }

  const handleResumeSession = (session: ChatSession) => {
    setSessionId(session.session_id)
    setSessionTitle(session.title)
  }

  const handleDeleteSession = (session: ChatSession) => {
    removeSession(session.session_id)
    clearSessionMessages(session.session_id)
    // If the deleted session was active, immediately reset to new-chat state
    if (session.session_id === sessionId) {
      setSessionId(null)
      setSessionTitle(null)
    }
    deleteChatSession(session.session_id)
      .then(() => bumpSessionVersion()) // refresh list + total from backend
      .catch(() => {})
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <aside
      style={{
        width: 240,
        background: LV.bg,
        borderRight: `1px solid ${LV.rule}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        flexShrink: 0,
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          height: 'var(--header-h)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          borderBottom: `1px solid ${LV.rule}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: LV.ink }}>
            <Mark size={26} />
            <span
              style={{
                fontFamily: LV.font.display,
                fontStyle: 'normal',
                fontWeight: 600,
                fontSize: 20,
                letterSpacing: '0',
                color: LV.ink,
              }}
            >
              LyndonLLM
            </span>
          </div>
          <button
            onClick={() => setSearchOpen((o) => !o)}
            title={searchOpen ? 'Close search' : 'Search messages'}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: searchOpen ? LV.gold : LV.mute,
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s',
            }}
          >
            <Search size={15} />
          </button>
        </div>
      </div>

      {/* Search input bar (shown when search icon is active) */}
      {searchOpen && (
        <div
          style={{
            padding: '8px 12px',
            borderBottom: `1px solid ${LV.rule}`,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: LV.elev,
              borderRadius: 6,
              padding: '5px 10px',
              border: `1px solid ${LV.rule}`,
            }}
          >
            <Search size={13} color={LV.mute} />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
              placeholder={
                mode === 'cowork'
                  ? 'Search sessions…'
                  : mode === 'code'
                    ? 'Search workspaces…'
                    : 'Search messages…'
              }
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                fontFamily: LV.font.sans,
                fontSize: 13,
                color: LV.ink,
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: LV.mute,
                  display: 'flex',
                  padding: 0,
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mode tabs — desktop only; web is chat-only */}
      {IS_TAURI && (
        <div style={{ display: 'flex', borderBottom: `1px solid ${LV.rule}`, flexShrink: 0 }}>
          {DESKTOP_MODES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => handleModeChange(id)}
              style={{
                flex: 1,
                padding: '11px 0 10px',
                textAlign: 'center',
                fontFamily: LV.font.sans,
                fontSize: 12.5,
                background: 'none',
                border: 'none',
                fontWeight: mode === id ? 500 : 400,
                color: mode === id ? LV.ink : LV.mute,
                cursor: 'pointer',
                borderBottom: `1px solid ${mode === id ? LV.gold : 'transparent'}`,
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* New chat + more menu */}
      <div
        style={{
          padding: '12px 16px 10px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          onClick={handleNewChat}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: LV.gold,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            fontFamily: LV.font.sans,
            fontSize: 12.5,
            fontWeight: 500,
            padding: 0,
          }}
        >
          {/* Plus icon */}
          <svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
          >
            <path d="M5 12h14M12 5v14" />
          </svg>
          {mode === 'chat' ? 'New chat' : 'New session'}
        </button>

        {/* More menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              title="More options"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                lineHeight: 0,
                color: currentSessionPrompt ? LV.gold : LV.mute,
              }}
              className="hover:!text-[var(--lv-ink)] transition-colors"
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="bottom"
              align="end"
              sideOffset={4}
              style={{
                zIndex: 200,
                minWidth: 180,
                background: 'var(--lv-card)',
                border: `1px solid var(--lv-rule-strong)`,
                padding: '4px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
              }}
              className={cn(
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              )}
            >
              <DropdownMenu.Item
                onSelect={() => setPromptOpen(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  outline: 'none',
                  fontFamily: LV.font.sans,
                  fontSize: 12.5,
                  color: LV.ink,
                }}
                className="hover:bg-accent focus:bg-accent transition-colors"
              >
                <MessageSquarePlus size={13} style={{ color: LV.mute }} />
                {currentSessionPrompt ? 'Edit session prompt' : 'New chat with a prompt'}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* Session prompt modal */}
      {promptOpen &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(2px)',
            }}
            onClick={() => setPromptOpen(false)}
          >
            <div
              style={{
                background: 'var(--lv-card)',
                border: '1px solid var(--lv-rule-strong)',
                padding: 24,
                width: 460,
                boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--lv-ink)',
                  marginBottom: 6,
                }}
              >
                Session Prompt
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--lv-mute)',
                  marginBottom: 14,
                  lineHeight: 1.6,
                }}
              >
                Quoted before your first message in this session. Applies once then clears.
              </p>
              <textarea
                ref={promptInputRef}
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setPromptOpen(false)
                  // Ctrl/Cmd+Enter to confirm
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePromptConfirm()
                }}
                placeholder="e.g. Assume I'm a senior backend engineer. Be terse and skip basics."
                rows={6}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'var(--lv-elev)',
                  border: '1px solid var(--lv-rule-strong)',
                  padding: '10px 12px',
                  resize: 'vertical',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--lv-ink)',
                  lineHeight: 1.6,
                  outline: 'none',
                  marginBottom: 16,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--lv-gold)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--lv-rule-strong)'
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setPromptOpen(false)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--lv-rule-strong)',
                    padding: '6px 14px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    color: 'var(--lv-soft)',
                  }}
                >
                  Cancel
                </button>
                {currentSessionPrompt && (
                  <button
                    onClick={() => {
                      setSessionPrompt(promptKey, '')
                      setPromptOpen(false)
                    }}
                    style={{
                      background: 'none',
                      border: '1px solid var(--lv-rule-strong)',
                      padding: '6px 14px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 12,
                      color: 'var(--lv-mute)',
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={handlePromptConfirm}
                  style={{
                    background: 'var(--lv-ink)',
                    border: 'none',
                    padding: '6px 18px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--lv-bg)',
                  }}
                >
                  Start
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Session list */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {searchOpen && searchQuery.trim() ? (
            /* ── Search results ── */
            <>
              <SectionLabel>Results</SectionLabel>
              {searchLoading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 16px',
                    color: LV.mute,
                    fontFamily: LV.font.mono,
                    fontSize: 11,
                  }}
                >
                  <Loader2 size={11} className="animate-spin" />
                  Searching…
                </div>
              )}
              {!searchLoading && searchResults.length === 0 && (
                <p
                  style={{
                    padding: '8px 16px',
                    fontFamily: LV.font.mono,
                    fontSize: 11,
                    color: LV.mute,
                  }}
                >
                  No results for &quot;{searchQuery}&quot;
                </p>
              )}
              {searchResults.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => {
                    setSessionId(s.session_id)
                    setSessionTitle(s.title)
                    setSearchOpen(false)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    padding: '8px 16px',
                    cursor: 'pointer',
                    borderLeft: `2px solid ${s.session_id === sessionId ? LV.gold : 'transparent'}`,
                  }}
                  className="hover:bg-[var(--lv-wash)]"
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: LV.ink,
                      fontFamily: LV.font.sans,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {s.title || 'Untitled'}
                  </div>
                  {s.snippet && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: LV.mute,
                        fontFamily: LV.font.sans,
                        marginTop: 2,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {s.snippet}
                    </div>
                  )}
                </button>
              ))}
            </>
          ) : (
            /* ── Normal session list ── */
            <>
              {loading ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 16px',
                    color: LV.mute,
                    fontFamily: LV.font.mono,
                    fontSize: 11,
                  }}
                >
                  <Loader2 size={11} className="animate-spin" />
                  Loading…
                </div>
              ) : sessions.length === 0 ? (
                <p
                  style={{
                    padding: '8px 16px',
                    fontFamily: LV.font.mono,
                    fontSize: 11,
                    color: LV.mute,
                  }}
                >
                  No history yet.
                </p>
              ) : (
                <>
                  {/* ── Pinned ── */}
                  {sessions.some((s) => pinnedSessionIds.includes(s.session_id)) && (
                    <>
                      <SectionLabel>Pinned</SectionLabel>
                      {sessions
                        .filter((s) => pinnedSessionIds.includes(s.session_id))
                        .sort(
                          (a, b) =>
                            pinnedSessionIds.indexOf(a.session_id) -
                            pinnedSessionIds.indexOf(b.session_id),
                        )
                        .map((s) => (
                          <SessionRow
                            key={s.session_id}
                            session={s}
                            active={sessionId === s.session_id}
                            isStreaming={streamingSet[s.session_id] === true}
                            isPinned
                            onSelect={handleResumeSession}
                            onDelete={handleDeleteSession}
                            onPin={() => unpinSession(s.session_id)}
                            onRename={(newTitle) => {
                              if (sessionId === s.session_id) setSessionTitle(newTitle || null)
                              bumpSessionVersion()
                            }}
                          />
                        ))}
                    </>
                  )}

                  {/* ── Recent ── */}
                  <SectionLabel>
                    {mode === 'cowork' ? 'Sessions' : mode === 'code' ? 'Workspaces' : 'Recent'}
                  </SectionLabel>
                  {sessions
                    .filter((s) => !pinnedSessionIds.includes(s.session_id))
                    .map((s) => (
                      <SessionRow
                        key={s.session_id}
                        session={s}
                        active={sessionId === s.session_id}
                        isStreaming={streamingSet[s.session_id] === true}
                        isPinned={false}
                        onSelect={handleResumeSession}
                        onDelete={handleDeleteSession}
                        onPin={() => pinSession(s.session_id)}
                        onRename={(newTitle) => {
                          if (sessionId === s.session_id) setSessionTitle(newTitle || null)
                          bumpSessionVersion()
                        }}
                      />
                    ))}
                  {hasMore && (
                    <div
                      ref={sentinelRef}
                      style={{ padding: '8px 16px', display: 'flex', justifyContent: 'center' }}
                    >
                      {loadingMore && (
                        <Loader2 size={11} className="animate-spin" style={{ color: LV.mute }} />
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer: Login (logged-out) or Settings (logged-in) + theme toggle */}
      <div
        style={{
          borderTop: `1px solid ${LV.rule}`,
          padding: '8px 16px 12px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {user ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '8px 0',
                    color: LV.mute,
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      background: 'var(--lv-card-elev)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: LV.font.mono,
                      fontSize: 11,
                      fontWeight: 600,
                      color: LV.ink,
                      flexShrink: 0,
                      overflow: 'hidden',
                    }}
                  >
                    {avatarVersion > 0 ? (
                      <img
                        src={getAvatarUrl(user.id, avatarVersion)}
                        alt=""
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                        onError={() => useAppStore.setState({ avatarVersion: 0 })}
                      />
                    ) : (
                      user.username[0].toUpperCase()
                    )}
                  </div>
                  <div style={{ flex: 1, textAlign: 'left', lineHeight: 1.2 }}>
                    <div
                      style={{
                        fontFamily: LV.font.sans,
                        fontSize: 12.5,
                        color: LV.ink,
                        fontWeight: 500,
                      }}
                    >
                      {user.username}
                    </div>
                    <div style={{ fontFamily: LV.font.mono, fontSize: 9.5, color: LV.mute }}>
                      Settings
                    </div>
                  </div>
                  {/* Sliders icon */}
                  <svg
                    width={14}
                    height={14}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  >
                    <line x1="4" x2="4" y1="21" y2="14" />
                    <line x1="4" x2="4" y1="10" y2="3" />
                    <line x1="12" x2="12" y1="21" y2="12" />
                    <line x1="12" x2="12" y1="8" y2="3" />
                    <line x1="20" x2="20" y1="21" y2="16" />
                    <line x1="20" x2="20" y1="12" y2="3" />
                    <line x1="2" x2="6" y1="14" y2="14" />
                    <line x1="10" x2="14" y1="8" y2="8" />
                    <line x1="18" x2="22" y1="16" y2="16" />
                  </svg>
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="top"
                  align="start"
                  sideOffset={4}
                  style={{
                    zIndex: 200,
                    width: 240,
                    background: 'var(--lv-card)',
                    border: `1px solid var(--lv-rule-strong)`,
                    padding: '4px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                  }}
                  className={cn(
                    'data-[state=open]:animate-in data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                  )}
                >
                  {(
                    [
                      { tab: 'profile' as SettingsTab, icon: UserCircle, label: 'Profile' },
                      { tab: 'knowledge' as SettingsTab, icon: BookOpen, label: 'Knowledge' },
                      { tab: 'tools' as SettingsTab, icon: Server, label: 'MCP' },
                      { tab: 'skills' as SettingsTab, icon: Puzzle, label: 'Skills' },
                      { tab: 'ai' as SettingsTab, icon: MessageSquare, label: 'AI & Chat' },
                    ] as const
                  ).map(({ tab, icon: Icon, label }) => (
                    <DropdownMenu.Item
                      key={tab}
                      onSelect={() => openSettings(tab)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        cursor: 'pointer',
                        outline: 'none',
                        fontFamily: LV.font.sans,
                        fontSize: 12.5,
                        color: LV.ink,
                      }}
                      className="hover:bg-accent focus:bg-accent transition-colors"
                    >
                      <Icon size={13} style={{ color: LV.mute }} />
                      {label}
                    </DropdownMenu.Item>
                  ))}

                  <DropdownMenu.Separator
                    style={{ height: 1, background: 'var(--lv-rule)', margin: '4px 0' }}
                  />

                  <DropdownMenu.Item
                    onSelect={logout}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      outline: 'none',
                      fontFamily: LV.font.sans,
                      fontSize: 12.5,
                      color: LV.ink,
                    }}
                    className="hover:bg-accent focus:bg-accent transition-colors"
                  >
                    Logout
                  </DropdownMenu.Item>

                  <DropdownMenu.Item
                    onSelect={() => setDeleteAccountOpen(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      outline: 'none',
                      fontFamily: LV.font.sans,
                      fontSize: 12.5,
                      color: '#dc2626',
                    }}
                    className="hover:bg-accent focus:bg-accent transition-colors"
                  >
                    Delete account
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <button
              onClick={() => setLoginOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '8px 0',
                color: LV.mute,
                fontFamily: LV.font.sans,
                fontSize: 12.5,
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  background: 'var(--lv-card-elev)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg
                  width={13}
                  height={13}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: 'var(--lv-mute)' }}
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <span style={{ color: LV.ink, fontWeight: 500 }}>Login</span>
            </button>
          )}
        </div>
        <ThemeToggle />
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialTab={settingsTab} />
      <LoginDialog
        open={loginOpen}
        onOpenChange={(o) => {
          setLoginOpen(o)
          if (!o) setPendingOAuthToken(null)
        }}
        pendingOAuthToken={pendingOAuthToken}
      />
      <DeleteAccountDialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen} />
    </aside>
  )
}

// ── SessionRow ────────────────────────────────────────────────────────────────
function SessionRow({
  session,
  active,
  isStreaming,
  isPinned,
  onSelect,
  onDelete,
  onPin,
  onRename,
}: {
  session: ChatSession
  active: boolean
  isStreaming: boolean
  isPinned: boolean
  onSelect: (s: ChatSession) => void
  onDelete: (s: ChatSession) => void
  onPin: () => void
  onRename: (newTitle: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [saving, setSaving] = useState(false)
  const trashRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close delete-confirm on outside click
  useEffect(() => {
    if (!confirming) return
    const onDown = (e: MouseEvent) => {
      if (
        !trashRef.current?.contains(e.target as Node) &&
        !bubbleRef.current?.contains(e.target as Node)
      )
        setConfirming(false)
    }
    const onScroll = () => setConfirming(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [confirming])

  // Focus input when rename modal opens
  useEffect(() => {
    if (renaming) setTimeout(() => inputRef.current?.focus(), 30)
  }, [renaming])

  const openRename = (e: React.MouseEvent) => {
    e.stopPropagation()
    setRenameVal(session.title ?? '')
    setRenaming(true)
  }

  const handleRenameConfirm = async () => {
    setSaving(true)
    try {
      await renameChatSession(session.session_id, renameVal.trim())
      onRename(renameVal.trim())
      setRenaming(false)
    } catch {
      /* ignore */
    } finally {
      setSaving(false)
    }
  }

  const bubbleStyle = (): React.CSSProperties => {
    if (!trashRef.current) return {}
    const r = trashRef.current.getBoundingClientRect()
    return { position: 'fixed', bottom: window.innerHeight - r.top + 6, left: r.right + 6 }
  }

  return (
    <div
      style={{
        padding: '7px 16px',
        cursor: 'pointer',
        position: 'relative',
        background: active ? 'var(--lv-elev)' : 'transparent',
        borderLeft: `2px solid ${active ? 'var(--lv-gold)' : 'transparent'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
      className="group"
      onClick={() => onSelect(session)}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          overflow: 'hidden',
          paddingRight: 64,
        }}
      >
        {isStreaming && <SidebarAsteriskAnimated size={11} />}
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12.5,
            fontWeight: active ? 500 : 400,
            color: active ? 'var(--lv-ink)' : 'var(--lv-soft)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 1,
          }}
        >
          {session.title ?? (session.mode === 'cowork' ? 'New task' : 'New chat')}
        </span>
        {session.mode !== 'chat' && (
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 3,
              background: 'var(--lv-rule)',
              color: 'var(--lv-mute)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.05em',
              flexShrink: 0,
            }}
          >
            {session.mode}
          </span>
        )}
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9.5,
          color: 'var(--lv-mute)',
        }}
      >
        {relativeTime(session.updated_at)}
      </span>

      {/* Action buttons — hidden until hover */}
      <div
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPin()
          }}
          title={isPinned ? 'Unpin' : 'Pin'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            color: isPinned ? 'var(--lv-gold)' : 'var(--lv-mute)',
            lineHeight: 0,
          }}
          className={isPinned ? undefined : 'hover:!text-[var(--lv-ink)] transition-colors'}
        >
          <Pin size={11} />
        </button>
        <button
          onClick={openRename}
          title="Rename"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            color: 'var(--lv-mute)',
            lineHeight: 0,
          }}
          className="hover:!text-[var(--lv-ink)] transition-colors"
        >
          <Pencil size={11} />
        </button>
        <button
          ref={trashRef}
          onClick={(e) => {
            e.stopPropagation()
            setConfirming((v) => !v)
          }}
          title="Delete"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            color: 'var(--lv-mute)',
            lineHeight: 0,
          }}
          className={cn(
            'hover:!text-[hsl(var(--destructive))] transition-colors',
            confirming && '!text-[hsl(var(--destructive))]',
          )}
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Rename modal */}
      {renaming &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(2px)',
            }}
            onClick={() => setRenaming(false)}
          >
            <div
              ref={renameRef}
              style={{
                background: 'var(--lv-card)',
                border: '1px solid var(--lv-rule-strong)',
                padding: 24,
                width: 320,
                boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--lv-ink)',
                  marginBottom: 14,
                }}
              >
                Rename chat
              </p>
              <input
                ref={inputRef}
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameConfirm()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                style={{
                  width: '100%',
                  background: 'var(--lv-elev)',
                  border: '1px solid var(--lv-rule-strong)',
                  padding: '8px 10px',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  color: 'var(--lv-ink)',
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: 16,
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setRenaming(false)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--lv-rule-strong)',
                    padding: '6px 14px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    color: 'var(--lv-soft)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRenameConfirm}
                  disabled={saving}
                  style={{
                    background: 'var(--lv-ink)',
                    border: 'none',
                    padding: '6px 14px',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--lv-bg)',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Confirm bubble */}
      {confirming &&
        createPortal(
          <div
            ref={bubbleRef}
            style={{
              ...bubbleStyle(),
              zIndex: 200,
              width: 220,
              background: 'var(--lv-card)',
              border: `1px solid var(--lv-rule-strong)`,
              boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
              padding: 16,
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                color: 'var(--lv-soft)',
                marginBottom: 12,
              }}
            >
              Delete{' '}
              <span style={{ color: 'var(--lv-ink)', fontWeight: 500 }}>
                {'"'}
                {session.title ?? 'New chat'}
                {'"'}
              </span>
              ?
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setConfirming(false)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: 'var(--lv-elev)',
                  border: `1px solid var(--lv-rule-strong)`,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11.5,
                  color: 'var(--lv-soft)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirming(false)
                  onDelete(session)
                }}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: 'hsl(var(--destructive))',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11.5,
                  color: 'hsl(var(--destructive-foreground))',
                }}
              >
                Delete
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
