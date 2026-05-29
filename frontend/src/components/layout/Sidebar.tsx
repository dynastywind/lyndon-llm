import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  MessageSquare,
  Code2,
  Settings,
  Plus,
  Loader2,
  BookOpen,
  Server,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useChatHistory } from '@/hooks/useChatHistory'
import { createChatSession, deleteChatSession } from '@/api/client'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import type { Mode, ChatSession } from '@/types'

// ─── constants ────────────────────────────────────────────────────────────────

const MODES: { id: Mode; label: string; icon: React.ElementType }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'code', label: 'Code', icon: Code2 },
]

// ─── helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(isoString).toLocaleDateString()
}

// ─── component ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const {
    mode, setMode,
    sessionId, setSessionId,
    setSessionTitle,
    clearMessages,
    bumpSessionVersion,
  } = useAppStore()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('knowledge')

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }

  const { sessions, loading, loadingMore, hasMore, sentinelRef, removeSession } =
    useChatHistory(mode === 'chat' ? 'chat' : 'code')

  // Keep the title fresh: the backend sets it after the first exchange, so
  // whenever the sessions list reloads we sync the current session's title.
  useEffect(() => {
    if (!sessionId) return
    const current = sessions.find((s) => s.session_id === sessionId)
    if (current) setSessionTitle(current.title)
  }, [sessions, sessionId, setSessionTitle])

  // ── new chat ───────────────────────────────────────────────────────────────
  // Don't create a DB session until the user actually sends a message.

  const handleNewChat = () => {
    if (!sessionId) return   // already in the "no thread" state — do nothing
    clearMessages()
    setSessionId(null)
    setSessionTitle(null)
  }

  // ── resume session ─────────────────────────────────────────────────────────
  // ChatWindow watches sessionId and loads messages itself.

  const handleResumeSession = (session: ChatSession) => {
    clearMessages()           // clear immediately to avoid flash of stale content
    setSessionId(session.session_id)
    setSessionTitle(session.title)
  }


  // ── delete session ─────────────────────────────────────────────────────────

  const handleDeleteSession = async (session: ChatSession) => {
    // Optimistic removal so the row disappears immediately.
    removeSession(session.session_id)

    // If deleting the currently active session, start a fresh one.
    if (session.session_id === sessionId) {
      clearMessages()
      try {
        const fresh = await createChatSession()
        setSessionId(fresh.session_id)
        bumpSessionVersion()
      } catch {
        clearMessages()
      }
    }

    // Fire-and-forget the actual delete; ignore 404 (already gone).
    deleteChatSession(session.session_id).catch(() => {})
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <aside className="flex flex-col w-56 h-screen bg-card border-r border-border shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border flex items-center gap-2.5 shrink-0">
        <img src="/icon.png" alt="LyndonLLM" className="w-7 h-7 object-contain" />
        <span className="text-lg font-semibold tracking-tight">LyndonLLM</span>
      </div>

      {/* Horizontal mode tabs */}
      <div className="grid grid-cols-2 border-b border-border shrink-0">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={cn(
              'flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors',
              mode === id
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Content area — scrollable */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Functional section */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          {mode === 'chat' && (
            <button
              onClick={handleNewChat}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus size={15} />
              New Chat
            </button>
          )}
          {mode === 'code' && (
            <button disabled className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground opacity-50 cursor-not-allowed">
              <Plus size={15} />
              New Session
            </button>
          )}
        </div>

        {/* Recents section */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-1 mb-1.5">
            Recents
          </p>

          {loading ? (
            <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Loading…
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground/60">No history yet.</p>
          ) : (
            <>
              <ul className="space-y-0.5">
                {sessions.map((s) => (
                  <SessionRow
                    key={s.session_id}
                    session={s}
                    active={sessionId === s.session_id}
                    onSelect={handleResumeSession}
                    onDelete={handleDeleteSession}
                  />
                ))}
              </ul>

              {/* Infinite-scroll sentinel */}
              {hasMore && (
                <div ref={sentinelRef} className="py-2 flex justify-center">
                  {loadingMore && (
                    <Loader2 size={12} className="animate-spin text-muted-foreground" />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Settings — dropdown trigger */}
      <div className="px-3 pb-2 shrink-0">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground">
              <Settings size={18} className="shrink-0" />
              <span className="text-sm font-medium">Settings</span>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={4}
              className={cn(
                'z-50 min-w-[180px] rounded-lg border border-border bg-card p-1 shadow-lg',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                'data-[side=top]:slide-in-from-bottom-2',
              )}
            >
              <DropdownMenu.Item
                onSelect={() => openSettings('knowledge')}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground cursor-pointer select-none outline-none hover:bg-accent focus:bg-accent transition-colors"
              >
                <BookOpen size={14} className="text-muted-foreground shrink-0" />
                Knowledge
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => openSettings('tools')}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground cursor-pointer select-none outline-none hover:bg-accent focus:bg-accent transition-colors"
              >
                <Server size={14} className="text-muted-foreground shrink-0" />
                MCP
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <p className="text-xs text-muted-foreground">Local model · localhost:52415</p>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab={settingsTab}
      />
    </aside>
  )
}

// ─── SessionRow ───────────────────────────────────────────────────────────────

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: ChatSession
  active: boolean
  onSelect: (s: ChatSession) => void
  onDelete: (s: ChatSession) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const trashRef  = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  // Close on outside click or any scroll (position would be stale after scroll).
  useEffect(() => {
    if (!confirming) return
    const onDown = (e: MouseEvent) => {
      if (
        !trashRef.current?.contains(e.target as Node) &&
        !bubbleRef.current?.contains(e.target as Node)
      ) {
        setConfirming(false)
      }
    }
    const onScroll = () => setConfirming(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [confirming])

  // Compute fixed position below the trash button.
  const bubbleStyle = (): React.CSSProperties => {
    if (!trashRef.current) return {}
    const r = trashRef.current.getBoundingClientRect()
    return {
      position: 'fixed',
      bottom: window.innerHeight - r.top + 6,
      left:   r.right + 6,
    }
  }

  return (
    <li>
      <div
        className={cn(
          'group flex items-center rounded-lg transition-colors',
          active
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        )}
      >
        {/* Session info */}
        <button
          onClick={() => onSelect(session)}
          className="flex-1 min-w-0 text-left px-2.5 py-2"
        >
          <p className="text-xs font-medium truncate leading-tight">
            {session.title ?? 'New chat'}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            {relativeTime(session.updated_at)}
          </p>
        </button>

        {/* Trash button — stays highlighted while bubble is open */}
        <button
          ref={trashRef}
          onClick={(e) => { e.stopPropagation(); setConfirming((v) => !v) }}
          title="Delete chat"
          className={cn(
            'shrink-0 mr-1.5 p-1 rounded-md transition-all duration-150',
            'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto',
            'text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10',
            confirming && 'opacity-100 pointer-events-auto text-destructive bg-destructive/10',
          )}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Confirmation bubble — portalled to <body> to escape overflow clipping */}
      {confirming && createPortal(
        <div
          ref={bubbleRef}
          style={bubbleStyle()}
          className="z-[200] w-56 rounded-lg border border-border bg-card shadow-xl p-4"
        >
          <p className="text-xs text-muted-foreground mb-3 leading-snug">
            Delete{' '}
            <span className="font-medium text-foreground">
              "{session.title ?? 'New chat'}"
            </span>?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 py-1.5 rounded-md text-xs font-medium bg-accent text-accent-foreground hover:bg-accent/80 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { setConfirming(false); onDelete(session) }}
              className="flex-1 py-1.5 rounded-md text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>,
        document.body,
      )}
    </li>
  )
}
