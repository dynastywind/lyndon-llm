import { MessageSquare, Wrench, Code2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { Mode } from '@/types'

const MODES: { id: Mode; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'chat',   label: 'Chat',   icon: MessageSquare, description: 'Q&A, search, RAG' },
  { id: 'cowork', label: 'Cowork', icon: Wrench,        description: 'Plan & execute tasks' },
  { id: 'code',   label: 'Code',   icon: Code2,         description: 'Edit, review, deploy' },
]

export function Sidebar() {
  const { mode, setMode } = useAppStore()

  return (
    <aside className="flex flex-col w-56 h-screen bg-card border-r border-border shrink-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border">
        <span className="text-lg font-semibold tracking-tight">LyndonLLM</span>
      </div>

      {/* Mode selector */}
      <nav className="flex flex-col gap-1 p-3 flex-1">
        {MODES.map(({ id, label, icon: Icon, description }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={cn(
              'flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
              mode === id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className={cn(
                'text-xs',
                mode === id ? 'text-primary-foreground/70' : 'text-muted-foreground',
              )}>
                {description}
              </div>
            </div>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-xs text-muted-foreground">Local model · localhost:52415</p>
      </div>
    </aside>
  )
}
