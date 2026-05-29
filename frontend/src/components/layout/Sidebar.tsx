import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { BookOpen, Server, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useChatHistory } from '@/hooks/useChatHistory'
import { createChatSession, deleteChatSession } from '@/api/client'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import type { Mode, ChatSession } from '@/types'

// ── Lyndon Vision palette (local constants matching CSS vars) ─────────────────
const LV = {
  bg:         'var(--lv-bg)',
  elev:       'var(--lv-elev)',
  ink:        'var(--lv-ink)',
  soft:       'var(--lv-soft)',
  mute:       'var(--lv-mute)',
  rule:       'var(--lv-rule)',
  gold:       'var(--lv-gold)',
  font: {
    sans:    'var(--font-sans)',
    display: 'var(--font-display)',
    mono:    'var(--font-mono)',
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

// ── Animated asterisk (sidebar session rows while streaming) ──────────────────
function SidebarAsteriskAnimated({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none"
         stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"
         className="lv-asterisk-animated"
         style={{ flex: 'none', color: 'var(--lv-gold)' }}>
      <line className="spoke" x1="50" y1="39" x2="50" y2="10"
        style={{ '--len':'29','--opmin':'0.55', strokeDasharray:29, animationName:'emit,flicker', animationDuration:'1.8s,1.1s', animationDelay:'0s,0.2s', animationTimingFunction:'cubic-bezier(.4,0,.2,1),ease-in-out', animationIterationCount:'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="59.526" y1="44.5" x2="84.641" y2="30"
        style={{ '--len':'29','--opmin':'0.7',  strokeDasharray:29, animationName:'emit,flicker', animationDuration:'2.1s,1.7s', animationDelay:'0.35s,0.8s', animationTimingFunction:'cubic-bezier(.4,0,.2,1),ease-in-out', animationIterationCount:'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="59.526" y1="55.5" x2="84.641" y2="70"
        style={{ '--len':'29','--opmin':'0.4',  strokeDasharray:29, animationName:'emit,flicker', animationDuration:'1.65s,0.95s', animationDelay:'1.2s,0.05s', animationTimingFunction:'cubic-bezier(.4,0,.2,1),ease-in-out', animationIterationCount:'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="50" y1="61" x2="50" y2="90"
        style={{ '--len':'29','--opmin':'0.65', strokeDasharray:29, animationName:'emit,flicker', animationDuration:'2.3s,2.4s', animationDelay:'0.55s,1.3s', animationTimingFunction:'cubic-bezier(.4,0,.2,1),ease-in-out', animationIterationCount:'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="40.474" y1="55.5" x2="15.359" y2="70"
        style={{ '--len':'29','--opmin':'0.5',  strokeDasharray:29, animationName:'emit,flicker', animationDuration:'1.5s,1.25s', animationDelay:'1.55s,0.5s', animationTimingFunction:'cubic-bezier(.4,0,.2,1),ease-in-out', animationIterationCount:'infinite,infinite' } as React.CSSProperties} />
      <line className="spoke" x1="40.474" y1="44.5" x2="15.359" y2="30"
        style={{ '--len':'29','--opmin':'0.75', strokeDasharray:29, animationName:'emit,flicker', animationDuration:'1.95s,1.85s', animationDelay:'0.85s,1.05s', animationTimingFunction:'cubic-bezier(.4,0,.2,1),ease-in-out', animationIterationCount:'infinite,infinite' } as React.CSSProperties} />
      <circle className="core" cx="50" cy="50" r="5.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

// ── Modes ─────────────────────────────────────────────────────────────────────
const MODES: { id: Mode; label: string }[] = [
  { id: 'chat',   label: 'Chat'   },
  { id: 'code',   label: 'Code'   },
]

// ── component ─────────────────────────────────────────────────────────────────
export function Sidebar() {
  const {
    mode, setMode,
    sessionId, setSessionId,
    setSessionTitle,
    clearSessionMessages,
    streamingSet,
    bumpSessionVersion,
  } = useAppStore()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab,  setSettingsTab]  = useState<SettingsTab>('knowledge')

  const openSettings = (tab: SettingsTab) => { setSettingsTab(tab); setSettingsOpen(true) }

  const { sessions, loading, loadingMore, hasMore, sentinelRef, removeSession } =
    useChatHistory(mode === 'chat' ? 'chat' : 'code')

  useEffect(() => {
    if (!sessionId) return
    const current = sessions.find((s) => s.session_id === sessionId)
    if (current) setSessionTitle(current.title)
  }, [sessions, sessionId, setSessionTitle])

  const handleNewChat = () => {
    if (!sessionId) return
    setSessionId(null); setSessionTitle(null)
  }

  const handleResumeSession = (session: ChatSession) => {
    setSessionId(session.session_id); setSessionTitle(session.title)
  }

  const handleDeleteSession = async (session: ChatSession) => {
    removeSession(session.session_id)
    clearSessionMessages(session.session_id)
    if (session.session_id === sessionId) {
      try {
        const fresh = await createChatSession()
        setSessionId(fresh.session_id)
        bumpSessionVersion()
      } catch { setSessionId(null) }
    }
    deleteChatSession(session.session_id).catch(() => {})
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <aside style={{
      width: 240, background: LV.bg, borderRight: `1px solid ${LV.rule}`,
      display: 'flex', flexDirection: 'column', height: '100vh', flexShrink: 0,
    }}>

      {/* Wordmark */}
      <div style={{ padding: '18px 16px 16px', borderBottom: `1px solid ${LV.rule}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: LV.ink }}>
          <Mark size={26} />
          <span style={{
            fontFamily: LV.font.sans, fontStyle: 'normal', fontWeight: 600,
            fontSize: 15, letterSpacing: '-0.01em', color: LV.ink,
          }}>LyndonLLM</span>
        </div>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${LV.rule}`, flexShrink: 0 }}>
        {MODES.map(({ id, label }) => (
          <button key={id} onClick={() => setMode(id)} style={{
            flex: 1, padding: '11px 0 10px', textAlign: 'center',
            fontFamily: LV.font.sans, fontSize: 12.5, background: 'none', border: 'none',
            fontWeight: mode === id ? 500 : 400,
            color: mode === id ? LV.ink : LV.mute,
            cursor: 'pointer',
            borderBottom: `1px solid ${mode === id ? LV.gold : 'transparent'}`,
            marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {/* New chat */}
      <div style={{ padding: '12px 16px 10px', flexShrink: 0 }}>
        <button onClick={handleNewChat} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          color: LV.gold, cursor: 'pointer', background: 'none', border: 'none',
          fontFamily: LV.font.sans, fontSize: 12.5, fontWeight: 500, padding: 0,
        }}>
          {/* Plus icon */}
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M5 12h14M12 5v14" />
          </svg>
          New chat
        </button>
      </div>

      {/* Recents */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Section header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', height: 28, flexShrink: 0,
        }}>
          <span style={{
            fontFamily: LV.font.mono, fontSize: 9.5, letterSpacing: '0.28em',
            textTransform: 'uppercase', color: LV.mute, fontWeight: 500,
          }}>Recent</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', color: LV.mute,
              fontFamily: LV.font.mono, fontSize: 11,
            }}>
              <Loader2 size={11} className="animate-spin" />
              Loading…
            </div>
          ) : sessions.length === 0 ? (
            <p style={{
              padding: '8px 16px', fontFamily: LV.font.mono, fontSize: 11, color: LV.mute,
            }}>No history yet.</p>
          ) : (
            <>
              {sessions.map((s) => (
                <SessionRow
                  key={s.session_id} session={s}
                  active={sessionId === s.session_id}
                  isStreaming={streamingSet[s.session_id] === true}
                  onSelect={handleResumeSession}
                  onDelete={handleDeleteSession}
                />
              ))}
              {hasMore && (
                <div ref={sentinelRef} style={{ padding: '8px 16px', display: 'flex', justifyContent: 'center' }}>
                  {loadingMore && <Loader2 size={11} className="animate-spin" style={{ color: LV.mute }} />}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Settings footer */}
      <div style={{ borderTop: `1px solid ${LV.rule}`, padding: '8px 16px 12px', flexShrink: 0 }}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 0', color: LV.mute,
            }}>
              {/* Avatar */}
              <div style={{
                width: 26, height: 26, background: 'var(--lv-card-elev)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: LV.font.mono, fontSize: 11, fontWeight: 600,
                color: LV.ink, flexShrink: 0,
              }}>L</div>
              <div style={{ flex: 1, textAlign: 'left', lineHeight: 1.2 }}>
                <div style={{ fontFamily: LV.font.sans, fontSize: 12.5, color: LV.ink, fontWeight: 500 }}>
                  Lyndon
                </div>
                <div style={{ fontFamily: LV.font.mono, fontSize: 9.5, color: LV.mute }}>
                  Settings
                </div>
              </div>
              {/* Sliders icon */}
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                <line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/>
                <line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/>
                <line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/>
                <line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/>
                <line x1="18" x2="22" y1="16" y2="16"/>
              </svg>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top" align="start" sideOffset={4}
              style={{
                zIndex: 200, width: 240, background: 'var(--lv-card)',
                border: `1px solid var(--lv-rule-strong)`,
                padding: '4px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
              }}
              className={cn(
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              )}
            >
              {([
                { tab: 'knowledge' as SettingsTab, icon: BookOpen, label: 'Knowledge' },
                { tab: 'tools'     as SettingsTab, icon: Server,   label: 'MCP'       },
              ] as const).map(({ tab, icon: Icon, label }) => (
                <DropdownMenu.Item
                  key={tab}
                  onSelect={() => openSettings(tab)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', cursor: 'pointer', outline: 'none',
                    fontFamily: LV.font.sans, fontSize: 12.5, color: LV.ink,
                  }}
                  className="hover:bg-accent focus:bg-accent transition-colors"
                >
                  <Icon size={13} style={{ color: LV.mute }} />
                  {label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialTab={settingsTab} />
    </aside>
  )
}

// ── SessionRow ────────────────────────────────────────────────────────────────
function SessionRow({
  session, active, isStreaming, onSelect, onDelete,
}: {
  session: ChatSession; active: boolean; isStreaming: boolean
  onSelect: (s: ChatSession) => void
  onDelete: (s: ChatSession) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const trashRef  = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!confirming) return
    const onDown  = (e: MouseEvent) => {
      if (!trashRef.current?.contains(e.target as Node) &&
          !bubbleRef.current?.contains(e.target as Node)) setConfirming(false)
    }
    const onScroll = () => setConfirming(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [confirming])

  const bubbleStyle = (): React.CSSProperties => {
    if (!trashRef.current) return {}
    const r = trashRef.current.getBoundingClientRect()
    return { position: 'fixed', bottom: window.innerHeight - r.top + 6, left: r.right + 6 }
  }

  return (
    <div
      style={{
        padding: '7px 16px', cursor: 'pointer', position: 'relative',
        background: active ? 'var(--lv-elev)' : 'transparent',
        borderLeft: `2px solid ${active ? 'var(--lv-gold)' : 'transparent'}`,
        display: 'flex', flexDirection: 'column', gap: 2,
      }}
      className="group"
      onClick={() => onSelect(session)}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        overflow: 'hidden', paddingRight: 20,
      }}>
        {isStreaming && <SidebarAsteriskAnimated size={11} />}
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 12.5,
          fontWeight: active ? 500 : 400,
          color: active ? 'var(--lv-ink)' : 'var(--lv-soft)',
          lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flexShrink: 1,
        }}>
          {session.title ?? 'New chat'}
        </span>
      </div>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--lv-mute)',
      }}>
        {relativeTime(session.updated_at)}
      </span>

      {/* Trash — hidden until hover */}
      <button
        ref={trashRef}
        onClick={(e) => { e.stopPropagation(); setConfirming((v) => !v) }}
        title="Delete"
        style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 4, color: 'var(--lv-mute)',
        }}
        className={cn(
          'opacity-0 group-hover:opacity-100 transition-opacity',
          'hover:!text-[hsl(var(--destructive))]',
          confirming && '!opacity-100 !text-[hsl(var(--destructive))]',
        )}
      >
        <Trash2 size={12} />
      </button>

      {/* Confirm bubble */}
      {confirming && createPortal(
        <div ref={bubbleRef} style={{
          ...bubbleStyle(), zIndex: 200, width: 220,
          background: 'var(--lv-card)', border: `1px solid var(--lv-rule-strong)`,
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)', padding: 16,
        }}>
          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--lv-soft)', marginBottom: 12,
          }}>
            Delete{' '}
            <span style={{ color: 'var(--lv-ink)', fontWeight: 500 }}>
              "{session.title ?? 'New chat'}"
            </span>?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirming(false)} style={{
              flex: 1, padding: '6px 0', background: 'var(--lv-elev)',
              border: `1px solid var(--lv-rule-strong)`, cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 11.5, color: 'var(--lv-soft)',
            }}>Cancel</button>
            <button onClick={() => { setConfirming(false); onDelete(session) }} style={{
              flex: 1, padding: '6px 0', background: 'hsl(var(--destructive))',
              border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 11.5,
              color: 'hsl(var(--destructive-foreground))',
            }}>Delete</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
