import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  MessageSquare,
  Wrench,
  Code2,
  Settings,
  Plus,
  Loader2,
  Upload,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useChatHistory } from '@/hooks/useChatHistory'
import { createChatSession, getChatMessages } from '@/api/client'
import { SettingsDialog } from './SettingsDialog'
import type { Mode, ChatSession, ChatSessionMessage } from '@/types'

// ─── constants ────────────────────────────────────────────────────────────────

const MODES: { id: Mode; label: string; icon: React.ElementType }[] = [
  { id: 'chat',   label: 'Chat',   icon: MessageSquare },
  { id: 'cowork', label: 'Cowork', icon: Wrench },
  { id: 'code',   label: 'Code',   icon: Code2 },
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
    setMessages, clearMessages,
    bumpSessionVersion,
  } = useAppStore()

  const [uploadOpen, setUploadOpen] = useState(false)

  const { sessions, loading, loadingMore, hasMore, sentinelRef } =
    useChatHistory(mode === 'chat' ? 'chat' : mode === 'cowork' ? 'cowork' : 'code')

  // ── new chat ───────────────────────────────────────────────────────────────

  const handleNewChat = async () => {
    try {
      const session = await createChatSession()
      setSessionId(session.session_id)
      clearMessages()
      bumpSessionVersion()
    } catch {
      clearMessages()
    }
  }

  // ── resume session ─────────────────────────────────────────────────────────

  const handleResumeSession = async (session: ChatSession) => {
    setSessionId(session.session_id)
    try {
      const { messages: dbMessages } = await getChatMessages(session.session_id)
      setMessages(
        dbMessages.map((m: ChatSessionMessage) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant' | 'tool',
          content: m.content,
          timestamp: new Date(m.created_at),
          toolName: m.tool_name ?? undefined,
        })),
      )
    } catch {
      clearMessages()
    }
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
      <div className="grid grid-cols-3 border-b border-border shrink-0">
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
          {mode === 'cowork' && (
            <button disabled className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground opacity-50 cursor-not-allowed">
              <Plus size={15} />
              New Task
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
                onSelect={() => setUploadOpen(true)}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground cursor-pointer select-none outline-none hover:bg-accent focus:bg-accent transition-colors"
              >
                <Upload size={14} className="text-muted-foreground shrink-0" />
                Upload source
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <p className="text-xs text-muted-foreground">Local model · localhost:52415</p>
      </div>

      <SettingsDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </aside>
  )
}

// ─── SessionRow ───────────────────────────────────────────────────────────────

function SessionRow({
  session,
  active,
  onSelect,
}: {
  session: ChatSession
  active: boolean
  onSelect: (s: ChatSession) => void
}) {
  return (
    <li>
      <button
        onClick={() => onSelect(session)}
        className={cn(
          'w-full text-left px-2.5 py-2 rounded-lg transition-colors',
          active
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        )}
      >
        <p className="text-xs font-medium truncate leading-tight">
          {session.title ?? 'New chat'}
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          {relativeTime(session.updated_at)}
        </p>
      </button>
    </li>
  )
}
