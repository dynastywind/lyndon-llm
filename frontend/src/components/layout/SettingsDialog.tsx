import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { deleteRagSource, listRagSources, uploadRagFile } from '@/api/client'
import { useAppStore } from '@/store'
import { ToolsRegistryPanel } from './ToolsRegistryPanel'
import { MemoryPanel } from './MemoryPanel'

// ─── types ────────────────────────────────────────────────────────────────────

type UploadStatus = 'pending' | 'uploading' | 'done' | 'error'

interface UploadItem {
  id: string
  file: File
  status: UploadStatus
  chunks?: number
  error?: string
}

export type SettingsTab = 'knowledge' | 'tools' | 'memory' | 'prompts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: SettingsTab
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const ACCEPTED = '.pdf,.md,.mdx,.txt,.py,.ts,.tsx,.js,.jsx,.go,.rs,.java,.cpp,.c'

function basename(path: string) {
  return path.split('/').pop() ?? path
}

// ─── component ────────────────────────────────────────────────────────────────

export function SettingsDialog({ open, onOpenChange, initialTab = 'knowledge' }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [queue, setQueue] = useState<UploadItem[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── fetch indexed sources ──────────────────────────────────────────────────

  const fetchSources = useCallback(async () => {
    setLoadingSources(true)
    try {
      const { sources } = await listRagSources()
      setSources(sources)
    } catch {
      // silently ignore — backend may not be up
    } finally {
      setLoadingSources(false)
    }
  }, [])

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  const handleOpenChange = (v: boolean) => {
    onOpenChange(v)
    if (v) fetchSources()
    else setQueue([])          // clear queue on close
  }

  // ── uploads ───────────────────────────────────────────────────────────────

  const uploadOne = useCallback(async (item: UploadItem) => {
    setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: 'uploading' } : i)))
    try {
      const result = await uploadRagFile(item.file)
      setQueue((q) =>
        q.map((i) =>
          i.id === item.id ? { ...i, status: 'done', chunks: result.chunks_stored } : i,
        ),
      )
      // Refresh the indexed sources list after a successful upload
      fetchSources()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed'
      setQueue((q) =>
        q.map((i) => (i.id === item.id ? { ...i, status: 'error', error: msg } : i)),
      )
    }
  }, [fetchSources])

  const enqueue = useCallback(
    (files: FileList | File[]) => {
      const items: UploadItem[] = Array.from(files).map((file) => ({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        status: 'pending',
      }))
      setQueue((q) => [...q, ...items])
      items.forEach(uploadOne)
    },
    [uploadOne],
  )

  // ── delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (source: string) => {
    try {
      await deleteRagSource(source)
      setSources((s) => s.filter((x) => x !== source))
    } catch {
      // TODO: surface error toast
    }
  }

  // ── drag-and-drop ─────────────────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) enqueue(e.dataTransfer.files)
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        {/* Panel */}
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-[580px] max-h-[82vh] bg-card border border-border rounded-xl shadow-2xl',
            'flex flex-col overflow-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          )}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <Dialog.Title className="text-sm font-semibold">Settings</Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground transition-colors rounded p-0.5">
              <X size={15} />
            </Dialog.Close>
          </div>

          {/* ── Tabs ── */}
          <div className="flex gap-1 px-5 pt-3 border-b border-border shrink-0">
            <TabButton active={tab === 'knowledge'} onClick={() => setTab('knowledge')}>
              Knowledge Base
            </TabButton>
            <TabButton active={tab === 'tools'} onClick={() => setTab('tools')}>
              MCP
            </TabButton>
            <TabButton active={tab === 'memory'} onClick={() => setTab('memory')}>
              Memory
            </TabButton>
            <TabButton active={tab === 'prompts'} onClick={() => setTab('prompts')}>
              Prompts
            </TabButton>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-y-auto p-5">
          {tab === 'tools' ? (
            <ToolsRegistryPanel active={open && tab === 'tools'} />
          ) : tab === 'memory' ? (
            <MemoryPanel active={open && tab === 'memory'} />
          ) : tab === 'prompts' ? (
            <PromptsPanel />
          ) : (
          <div className="space-y-7">
            {/* ── Upload section ── */}
            <section>
              <SectionLabel>Knowledge Base — Upload</SectionLabel>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-lg px-4 py-8 text-center cursor-pointer',
                  'transition-colors select-none',
                  dragging
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/40 hover:bg-accent/20',
                )}
              >
                <Upload size={20} className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drop files here or{' '}
                  <span className="text-primary font-medium">browse</span>
                </p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  PDF · MD · TXT · Python · TypeScript · Go · Rust · Java…
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) enqueue(e.target.files)
                    // reset so same file can be re-uploaded
                    e.target.value = ''
                  }}
                />
              </div>

              {/* Upload queue */}
              {queue.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {queue.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 bg-background rounded-lg px-3 py-2 text-sm"
                    >
                      <FileText size={14} className="text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{item.file.name}</span>

                      {item.status === 'uploading' && (
                        <Loader2 size={14} className="animate-spin text-primary shrink-0" />
                      )}
                      {item.status === 'done' && (
                        <span className="flex items-center gap-1 text-xs text-green-400 shrink-0">
                          <CheckCircle2 size={13} />
                          {item.chunks} chunks
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span
                          className="flex items-center gap-1 text-xs text-red-400 shrink-0 max-w-[180px] truncate"
                          title={item.error}
                        >
                          <AlertCircle size={13} className="shrink-0" />
                          {item.error}
                        </span>
                      )}
                      {item.status === 'pending' && (
                        <span className="text-xs text-muted-foreground shrink-0">Queued</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Indexed sources section ── */}
            <section>
              <SectionLabel>Knowledge Base — Indexed</SectionLabel>

              {loadingSources ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  Loading…
                </div>
              ) : sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No documents indexed yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {sources.map((src) => (
                    <li
                      key={src}
                      className="flex items-center gap-3 bg-background rounded-lg px-3 py-2 group"
                    >
                      <FileText size={14} className="text-muted-foreground shrink-0" />
                      <span
                        className="flex-1 text-sm truncate"
                        title={src}
                      >
                        {basename(src)}
                      </span>
                      <button
                        onClick={() => handleDelete(src)}
                        title={`Remove "${basename(src)}" from index`}
                        className={cn(
                          'text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0',
                          'opacity-0 group-hover:opacity-100',
                        )}
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── PromptsPanel ─────────────────────────────────────────────────────────────

function PromptsPanel() {
  const { systemPrompt, setSystemPrompt } = useAppStore()
  const [draft, setDraft] = useState(systemPrompt)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSystemPrompt(draft.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <SectionLabel>System Prompt</SectionLabel>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--lv-mute)',
          marginBottom: 12, lineHeight: 1.6,
        }}>
          Applied globally to every chat session. Injected into the model&apos;s
          system instructions alongside the base prompt.
        </p>
        <textarea
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setSaved(false) }}
          placeholder="e.g. Always respond in British English. Be concise."
          rows={10}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--lv-elev)', border: '1px solid var(--lv-rule-strong)',
            padding: '10px 12px', resize: 'vertical',
            fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--lv-ink)',
            lineHeight: 1.6, outline: 'none',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--lv-gold)' }}
          onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--lv-rule-strong)' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
          {draft.trim() !== systemPrompt && (
            <button onClick={() => { setDraft(systemPrompt); setSaved(false) }} style={{
              background: 'none', border: '1px solid var(--lv-rule-strong)',
              padding: '6px 14px', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--lv-mute)',
            }}>Reset</button>
          )}
          <button onClick={handleSave} style={{
            background: saved ? 'transparent' : 'var(--lv-ink)',
            border: saved ? '1px solid var(--lv-gold)' : 'none',
            padding: '6px 18px', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600,
            color: saved ? 'var(--lv-gold)' : 'var(--lv-bg)',
            transition: 'all 0.2s',
          }}>
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  )
}

// ─── tiny sub-component ───────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
      {children}
    </h3>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
        active
          ? 'text-foreground border-b-2 border-primary -mb-px'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
