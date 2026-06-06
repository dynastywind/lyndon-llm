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
import { useT } from '@/i18n'
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
function relativeTime(
  isoString: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return t('sidebar.timeNow')
  if (mins < 60) return t('sidebar.timeMinutes', { mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('sidebar.timeHours', { hours })
  const days = Math.floor(hours / 24)
  if (days === 1) return t('sidebar.timeYesterday')
  if (days < 7) return t('sidebar.timeDays', { days })
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
  const { t } = useT()
  const {
    mode,
    setMode,
    sessionId,
    setSessionId,
    setSessionTitle,
    clearSessionMessages,
    streamingSet,
    bumpSessionVersion,
    bumpHomeVersion,
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

  // Search dialog
  const [searchOpen, setSearchOpen] = useState(false)

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

  // ⌘K / Ctrl+K global shortcut — toggles the search dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleNewChat = () => {
    if (!sessionId) return
    setSessionId(null)
    setSessionTitle(null)
    bumpHomeVersion()
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
    // Always return to the home screen after deletion
    setSessionId(null)
    setSessionTitle(null)
    bumpHomeVersion()
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
            onClick={() => setSearchOpen(true)}
            title={t('sidebar.searchTitle')}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: LV.mute,
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s',
            }}
            className="hover:!text-[var(--lv-gold)] transition-colors"
          >
            <Search size={16} />
          </button>
        </div>
      </div>

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
          {mode === 'chat' ? t('sidebar.newChat') : t('sidebar.newSession')}
        </button>

        {/* More menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              title={t('sidebar.moreOptions')}
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
                {currentSessionPrompt
                  ? t('sidebar.editSessionPrompt')
                  : t('sidebar.newChatWithPrompt')}
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
                {t('sidebar.sessionPromptTitle')}
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
                {t('sidebar.sessionPromptHint')}
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
                placeholder={t('sidebar.sessionPromptPlaceholder')}
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
                  {t('sidebar.cancel')}
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
                    {t('sidebar.clear')}
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
                  {t('sidebar.start')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Session list */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
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
              {t('sidebar.loading')}
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
              {t('sidebar.noHistory')}
            </p>
          ) : (
            <>
              {/* ── Pinned ── */}
              {sessions.some((s) => pinnedSessionIds.includes(s.session_id)) && (
                <>
                  <SectionLabel>{t('sidebar.sectionPinned')}</SectionLabel>
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
                {mode === 'cowork'
                  ? t('sidebar.sectionSessions')
                  : mode === 'code'
                    ? t('sidebar.sectionWorkspaces')
                    : t('sidebar.sectionRecent')}
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
                      {t('sidebar.settings')}
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
                      {
                        tab: 'profile' as SettingsTab,
                        icon: UserCircle,
                        label: t('sidebar.tabProfile'),
                      },
                      {
                        tab: 'knowledge' as SettingsTab,
                        icon: BookOpen,
                        label: t('sidebar.tabKnowledge'),
                      },
                      { tab: 'tools' as SettingsTab, icon: Server, label: t('sidebar.tabMcp') },
                      { tab: 'skills' as SettingsTab, icon: Puzzle, label: t('sidebar.tabSkills') },
                      { tab: 'ai' as SettingsTab, icon: MessageSquare, label: t('sidebar.tabAi') },
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
                    {t('sidebar.logout')}
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
                    {t('sidebar.deleteAccount')}
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
              <span style={{ color: LV.ink, fontWeight: 500 }}>{t('sidebar.login')}</span>
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
      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(session) => {
          setSessionId(session.session_id)
          setSessionTitle(session.title)
          setSearchOpen(false)
        }}
        mode={mode}
      />
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
  const { t } = useT()
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
          {session.title ??
            (session.mode === 'cowork' ? t('sidebar.newTask') : t('sidebar.newChat'))}
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
        {relativeTime(session.updated_at, t)}
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
          title={isPinned ? t('sidebar.unpin') : t('sidebar.pin')}
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
          title={t('sidebar.rename')}
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
          title={t('sidebar.delete')}
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
                {t('sidebar.renameChat')}
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
                  {t('sidebar.cancel')}
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
                  {saving ? t('sidebar.saving') : t('sidebar.confirm')}
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
            onClick={(e) => e.stopPropagation()}
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
              {t('sidebar.deleteConfirmPrefix')}{' '}
              <span style={{ color: 'var(--lv-ink)', fontWeight: 500 }}>
                {'"'}
                {session.title ?? t('sidebar.newChat')}
                {'"'}
              </span>
              {t('sidebar.deleteConfirmSuffix')}
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
                {t('sidebar.cancel')}
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
                {t('sidebar.delete')}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

// ── SearchResultRow ───────────────────────────────────────────────────────────
function SearchResultRow({
  session,
  highlighted,
  onMouseEnter,
  onClick,
}: {
  session: ChatSession & { snippet?: string }
  highlighted: boolean
  onMouseEnter: () => void
  onClick: () => void
}) {
  const { t } = useT()
  const [hover, setHover] = useState(false)
  const isLit = highlighted || hover
  return (
    <div
      onMouseEnter={() => {
        setHover(true)
        onMouseEnter()
      }}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '13px 20px 13px 24px',
        cursor: 'pointer',
        background: isLit ? 'var(--lv-elev)' : 'transparent',
        borderRadius: isLit ? 8 : 0,
        margin: '0 8px',
        transition: 'background 0.12s cubic-bezier(0.2,0.8,0.2,1)',
      }}
    >
      <MessageSquare
        size={20}
        strokeWidth={1.4}
        style={{
          flexShrink: 0,
          color: isLit ? 'var(--lv-soft)' : 'var(--lv-mute)',
          transition: 'color 0.12s',
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: 'var(--font-sans)',
          fontSize: 15,
          fontWeight: 400,
          color: isLit ? 'var(--lv-ink)' : 'var(--lv-soft)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'color 0.12s',
        }}
      >
        {session.title || t('sidebar.untitled')}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--lv-mute)',
          flexShrink: 0,
          letterSpacing: '0.04em',
        }}
      >
        {relativeTime(session.updated_at, t)}
      </span>
    </div>
  )
}

// ── SearchDialog ──────────────────────────────────────────────────────────────
function SearchDialog({
  open,
  onClose,
  onSelect,
  mode,
}: {
  open: boolean
  onClose: () => void
  onSelect: (session: ChatSession) => void
  mode: string
}) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<(ChatSession & { snippet?: string })[]>([])
  const [loading, setLoading] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus & reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlightIdx(0)
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // Escape key closes the dialog
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Debounced backend search
  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const data = await searchChatSessions(mode === 'chat' ? 'chat' : 'code', query.trim())
        setResults(data.sessions)
        setHighlightIdx(0)
      } catch {
        /* ignore network errors */
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, open, mode])

  if (!open) return null

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh',
        animation: 'lv-search-backdrop 0.15s ease-out',
      }}
    >
      <style>{`
        @keyframes lv-search-backdrop { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lv-search-panel { from { opacity: 0; transform: translateY(-8px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 680,
          background: 'var(--lv-bg)',
          border: '1px solid var(--lv-rule-strong)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '70vh',
          animation: 'lv-search-panel 0.2s cubic-bezier(0.2,0.8,0.2,1)',
          overflow: 'hidden',
        }}
      >
        {/* Search input header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '16px 20px',
            borderBottom: '1px solid var(--lv-rule)',
            flexShrink: 0,
          }}
        >
          <Search size={18} style={{ color: 'var(--lv-mute)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlightIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlightIdx((i) => Math.min(i + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlightIdx((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter' && results.length > 0) {
                onSelect(results[highlightIdx])
              }
            }}
            placeholder={t('sidebar.searchPlaceholder')}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
              fontWeight: 400,
              color: 'var(--lv-ink)',
              caretColor: 'var(--lv-gold)',
            }}
          />
          {/* Gold status dot */}
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: 'var(--lv-gold)',
              flexShrink: 0,
              display: 'inline-block',
            }}
          />
          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--lv-mute)',
              lineHeight: 0,
              padding: 2,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--lv-ink)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--lv-mute)'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Results list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {loading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '32px 24px',
                justifyContent: 'center',
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                color: 'var(--lv-mute)',
              }}
            >
              <Loader2 size={14} className="animate-spin" />
              {t('sidebar.searching')}
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div
              style={{
                padding: '32px 24px',
                textAlign: 'center',
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                color: 'var(--lv-mute)',
              }}
            >
              {t('sidebar.noResults')}
            </div>
          )}
          {!loading &&
            results.map((session, idx) => (
              <SearchResultRow
                key={session.session_id}
                session={session}
                highlighted={idx === highlightIdx}
                onMouseEnter={() => setHighlightIdx(idx)}
                onClick={() => onSelect(session)}
              />
            ))}
        </div>

        {/* Footer keyboard hints */}
        <div
          style={{
            borderTop: '1px solid var(--lv-rule)',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexShrink: 0,
          }}
        >
          {(
            [
              { id: 'navigate', label: t('sidebar.hintNavigate') },
              { id: 'open', label: t('sidebar.hintOpen') },
              { id: 'close', label: t('sidebar.hintClose') },
            ] as const
          ).map((hint) => (
            <span
              key={hint.id}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--lv-mute)',
                letterSpacing: '0.04em',
              }}
            >
              {hint.label}
            </span>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
