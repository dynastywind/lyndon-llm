import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, CheckCircle2, Loader2, Moon, RefreshCw, Search, Sun, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  checkRagSourceName,
  deleteRagSource,
  listRagSources,
  reindexRagSource,
  uploadRagFile,
  type RagSource,
} from '@/api/client'
import { useAppStore } from '@/store'
import { CODE_THEME_OPTIONS } from '@/config/codeThemes'
import { ToolsRegistryPanel } from './ToolsRegistryPanel'

// ─── types ────────────────────────────────────────────────────────────────────

type UploadStatus = 'checking' | 'conflict' | 'pending' | 'uploading' | 'done' | 'error'

interface UploadItem {
  id: string
  file: File
  status: UploadStatus
  chunks?: number
  error?: string
  existingPath?: string // populated when status === 'conflict'
}

export type SettingsTab = 'knowledge' | 'tools' | 'prompts' | 'appearance'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: SettingsTab
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const ACCEPTED = '.pdf,.md,.mdx,.txt,.py,.ts,.tsx,.js,.jsx,.go,.rs,.java,.cpp,.c'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileExt(path: string): string {
  return (path.split('.').pop() ?? '').toUpperCase() || 'FILE'
}

function fileTypeLabel(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  const map: Record<string, string> = {
    txt: 'NOTE', md: 'NOTE', mdx: 'NOTE',
    pdf: 'PDF',
    py: 'CODE', ts: 'CODE', tsx: 'CODE', js: 'CODE', jsx: 'CODE',
    go: 'CODE', rs: 'CODE', java: 'CODE', cpp: 'CODE', c: 'CODE',
  }
  return map[ext] ?? (ext.toUpperCase() || 'FILE')
}

// ─── component ────────────────────────────────────────────────────────────────

export function SettingsDialog({ open, onOpenChange, initialTab = 'knowledge' }: Props) {
  const PAGE_SIZE = 10

  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [queue, setQueue] = useState<UploadItem[]>([])
  const [sources, setSources] = useState<RagSource[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loadingSources, setLoadingSources] = useState(false)
  const [reindexing, setReindexing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // ── debounce search query ─────────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  // reset to page 0 when search changes
  useEffect(() => { setPage(0) }, [debouncedQuery])

  // ── fetch indexed sources ──────────────────────────────────────────────────

  const fetchSources = useCallback(async (pg = page, q = debouncedQuery) => {
    setLoadingSources(true)
    try {
      const res = await listRagSources(PAGE_SIZE, pg * PAGE_SIZE, q)
      setSources(res.sources)
      setTotal(res.total)
    } catch {
      // silently ignore — backend may not be up
    } finally {
      setLoadingSources(false)
    }
  }, [page, debouncedQuery])

  useEffect(() => {
    if (open && tab === 'knowledge') fetchSources(page, debouncedQuery)
  }, [open, tab, page, debouncedQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  const handleOpenChange = (v: boolean) => {
    onOpenChange(v)
    if (!v) { setQueue([]); setPage(0); setSearchQuery('') }
  }

  // ── uploads ───────────────────────────────────────────────────────────────

  const uploadOne = useCallback(
    async (item: UploadItem) => {
      setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: 'uploading' } : i)))
      try {
        const result = await uploadRagFile(item.file)
        setQueue((q) =>
          q.map((i) =>
            i.id === item.id ? { ...i, status: 'done', chunks: result.chunks_stored } : i,
          ),
        )
        // Refresh the current page after a successful upload
        fetchSources(page, debouncedQuery)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Upload failed'
        setQueue((q) =>
          q.map((i) => (i.id === item.id ? { ...i, status: 'error', error: msg } : i)),
        )
      }
    },
    [fetchSources, page, debouncedQuery],
  )

  const enqueue = useCallback(
    async (files: FileList | File[]) => {
      const fileArr = Array.from(files)
      // Add all to queue as 'checking' first
      const items: UploadItem[] = fileArr.map((file) => ({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        status: 'checking',
      }))
      setQueue((q) => [...q, ...items])

      // Check each file for name conflicts, then decide status
      for (const item of items) {
        try {
          const { exists, path } = await checkRagSourceName(item.file.name)
          if (exists) {
            setQueue((q) =>
              q.map((i) =>
                i.id === item.id ? { ...i, status: 'conflict', existingPath: path ?? undefined } : i,
              ),
            )
          } else {
            setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: 'pending' } : i)))
            uploadOne({ ...item, status: 'pending' })
          }
        } catch {
          // If check fails, proceed with upload anyway
          setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: 'pending' } : i)))
          uploadOne({ ...item, status: 'pending' })
        }
      }
    },
    [uploadOne],
  )

  // ── reindex ───────────────────────────────────────────────────────────────

  const handleReindex = async (source: RagSource) => {
    setReindexing(source.path)
    try {
      const result = await reindexRagSource(source.path)
      setSources((s) =>
        s.map((x) => (x.path === source.path ? { ...x, chunks: result.chunks_stored } : x)),
      )
    } catch {
      // silently ignore
    } finally {
      setReindexing(null)
    }
  }

  // ── delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (source: RagSource) => {
    setDeleting(source.path)
    try {
      // deleteFile=true (default) removes the file from disk;
      // delete_by_source removes all chunks from the vector store.
      await deleteRagSource(source.path)
      // Refetch current page (total may decrease)
      const newPage = sources.length === 1 && page > 0 ? page - 1 : page
      setPage(newPage)
      fetchSources(newPage, debouncedQuery)
    } catch {
      // TODO: surface error toast
    } finally {
      setDeleting(null)
    }
  }

  // ── drag-and-drop ─────────────────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) enqueue(e.dataTransfer.files)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

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
            'w-[680px] max-h-[86vh] bg-card border border-border shadow-2xl',
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
            <TabButton active={tab === 'prompts'} onClick={() => setTab('prompts')}>
              Prompts
            </TabButton>
            <TabButton active={tab === 'appearance'} onClick={() => setTab('appearance')}>
              Appearance
            </TabButton>
          </div>

          {/* ── Body ── */}
          <div className={cn('flex-1 overflow-y-auto', tab === 'knowledge' ? '' : 'p-5')}>
            {tab === 'tools' ? (
              <ToolsRegistryPanel active={open && tab === 'tools'} />
            ) : tab === 'prompts' ? (
              <PromptsPanel />
            ) : tab === 'appearance' ? (
              <AppearancePanel />
            ) : (
              /* ── Knowledge Base ── */
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                style={{
                  outline: dragging ? '2px solid var(--lv-gold)' : 'none',
                  outlineOffset: -2,
                  transition: 'outline 0.15s',
                }}
              >
                {/* hidden file input */}
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) enqueue(e.target.files)
                    e.target.value = ''
                  }}
                />

                {/* Panel header */}
                <div style={{ padding: '28px 32px 20px' }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9.5,
                    letterSpacing: '0.28em',
                    color: 'var(--lv-gold)',
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}>
                    No. 07 — Knowledge Base
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                    <span style={{
                      fontFamily: 'var(--font-display)',
                      fontStyle: 'italic',
                      fontWeight: 500,
                      fontSize: 38,
                      color: 'var(--lv-ink)',
                      letterSpacing: '-0.015em',
                      lineHeight: 1,
                    }}>
                      Documents
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9.5,
                      letterSpacing: '0.22em',
                      color: 'var(--lv-mute)',
                      textTransform: 'uppercase',
                    }}>
                      {sources.length} on file
                    </span>
                  </div>
                </div>

                {/* Search + Add row */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '0 32px 0',
                  borderBottom: '1px solid var(--lv-rule)',
                  paddingBottom: 18,
                }}>
                  {/* Search input */}
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    borderBottom: '1px solid var(--lv-rule-strong)',
                    paddingBottom: 8,
                  }}>
                    <Search size={12} style={{ color: 'var(--lv-mute)', flexShrink: 0 }} />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search documents"
                      style={{
                        flex: 1,
                        background: 'none',
                        border: 'none',
                        outline: 'none',
                        fontFamily: 'var(--font-sans)',
                        fontSize: 13,
                        color: 'var(--lv-ink)',
                      }}
                    />
                  </div>
                  {/* Add document button */}
                  <button
                    onClick={() => inputRef.current?.click()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 18px',
                      border: '1px solid var(--lv-rule-strong)',
                      borderRadius: 999,
                      background: 'transparent',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9.5,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      color: 'var(--lv-ink)',
                      whiteSpace: 'nowrap',
                      transition: 'border-color 0.15s, color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--lv-gold)'
                      e.currentTarget.style.color = 'var(--lv-gold)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--lv-rule-strong)'
                      e.currentTarget.style.color = 'var(--lv-ink)'
                    }}
                  >
                    Add Document →
                  </button>
                </div>

                {/* Upload queue (inline, above list) */}
                {queue.length > 0 && (
                  <div style={{ padding: '12px 32px 0', borderBottom: '1px solid var(--lv-rule)' }}>
                    {queue.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 0',
                          borderBottom: '1px solid var(--lv-rule)',
                        }}
                      >
                        <div style={{
                          width: 52, height: 52, flexShrink: 0,
                          border: '1px solid var(--lv-rule-strong)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: 'var(--lv-mute)', textTransform: 'uppercase' }}>
                            {fileExt(item.file.name)}
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--lv-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.file.name}
                          </div>
                          {item.status === 'conflict' && (
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--lv-mute)', marginTop: 4 }}>
                              Already indexed
                            </div>
                          )}
                        </div>
                        {/* Status indicators */}
                        {(item.status === 'checking') && (
                          <Loader2 size={13} className="animate-spin" style={{ color: 'var(--lv-mute)', flexShrink: 0 }} />
                        )}
                        {item.status === 'uploading' && (
                          <Loader2 size={13} className="animate-spin" style={{ color: 'var(--lv-gold)', flexShrink: 0 }} />
                        )}
                        {item.status === 'done' && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--lv-gold)', flexShrink: 0 }}>
                            <CheckCircle2 size={12} /> {item.chunks} chunks
                          </span>
                        )}
                        {item.status === 'error' && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#dc2626', flexShrink: 0, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.error}>
                            <AlertCircle size={12} /> {item.error}
                          </span>
                        )}
                        {item.status === 'pending' && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--lv-mute)', flexShrink: 0 }}>Queued</span>
                        )}
                        {/* Conflict: Replace / Skip buttons */}
                        {item.status === 'conflict' && (
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <button
                              onClick={() => uploadOne({ ...item, status: 'pending' })}
                              style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--lv-gold)', background: 'none', border: '1px solid var(--lv-gold)', padding: '3px 10px', cursor: 'pointer' }}
                            >
                              Replace
                            </button>
                            <button
                              onClick={() => setQueue((q) => q.filter((i) => i.id !== item.id))}
                              style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--lv-mute)', background: 'none', border: '1px solid var(--lv-rule-strong)', padding: '3px 10px', cursor: 'pointer' }}
                            >
                              Skip
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Document list */}
                {loadingSources ? (
                  <div style={{ padding: '32px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--lv-mute)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em' }}>
                    <Loader2 size={13} className="animate-spin" /> Loading…
                  </div>
                ) : sources.length === 0 ? (
                  <div style={{ padding: '40px 32px', fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--lv-mute)' }}>
                    {debouncedQuery ? 'No matches' : 'No documents indexed yet'}
                  </div>
                ) : (
                  <>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {sources.map((src) => (
                        <KnowledgeRow
                          key={src.path}
                          src={src}
                          reindexing={reindexing === src.path}
                          deleting={deleting === src.path}
                          busy={reindexing !== null || deleting !== null}
                          onReindex={() => handleReindex(src)}
                          onDelete={() => handleDelete(src)}
                        />
                      ))}
                    </ul>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 32px',
                        borderTop: '1px solid var(--lv-rule)',
                      }}>
                        <button
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                          disabled={page === 0}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9.5,
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase',
                            color: page === 0 ? 'var(--lv-rule-strong)' : 'var(--lv-mute)',
                            background: 'none',
                            border: 'none',
                            cursor: page === 0 ? 'default' : 'pointer',
                            padding: 0,
                            transition: 'color 0.15s',
                          }}
                          onMouseEnter={(e) => { if (page > 0) e.currentTarget.style.color = 'var(--lv-gold)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = page === 0 ? 'var(--lv-rule-strong)' : 'var(--lv-mute)' }}
                        >
                          ← Prev
                        </button>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--lv-mute)', textTransform: 'uppercase' }}>
                          {page + 1} / {totalPages}
                        </span>
                        <button
                          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                          disabled={page >= totalPages - 1}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9.5,
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase',
                            color: page >= totalPages - 1 ? 'var(--lv-rule-strong)' : 'var(--lv-mute)',
                            background: 'none',
                            border: 'none',
                            cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                            padding: 0,
                            transition: 'color 0.15s',
                          }}
                          onMouseEnter={(e) => { if (page < totalPages - 1) e.currentTarget.style.color = 'var(--lv-gold)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = page >= totalPages - 1 ? 'var(--lv-rule-strong)' : 'var(--lv-mute)' }}
                        >
                          Next →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── KnowledgeRow ─────────────────────────────────────────────────────────────

function KnowledgeRow({
  src, reindexing, deleting, busy, onReindex, onDelete,
}: {
  src: RagSource
  reindexing: boolean
  deleting: boolean
  busy: boolean
  onReindex: () => void
  onDelete: () => void
}) {
  const [hov, setHov] = useState(false)
  const ext = fileExt(src.path)
  const typeLabel = fileTypeLabel(src.path)
  const meta = [
    typeLabel,
    src.size_bytes != null ? formatBytes(src.size_bytes) : null,
    `${src.chunks} chunk${src.chunks !== 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ')

  return (
    <li
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '18px 32px',
        borderBottom: '1px solid var(--lv-rule)',
        background: hov ? 'rgba(var(--lv-wash-rgb),0.03)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* File type badge */}
      <div style={{
        width: 52, height: 52, flexShrink: 0,
        border: `1px solid ${hov ? 'var(--lv-rule-strong)' : 'var(--lv-rule)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.15s',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.1em',
          color: 'var(--lv-gold)',
          textTransform: 'uppercase',
        }}>
          {ext.slice(0, 4)}
        </span>
      </div>

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--lv-ink)',
          letterSpacing: '-0.01em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 5,
        }} title={src.path}>
          {src.name}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--lv-mute)',
        }}>
          {meta}
        </div>
      </div>

      {/* Actions — visible on hover */}
      <div style={{
        display: 'flex',
        gap: 8,
        opacity: hov ? 1 : 0,
        transition: 'opacity 0.15s',
        flexShrink: 0,
      }}>
        <button
          onClick={onReindex}
          disabled={busy}
          title="Re-index"
          style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', color: 'var(--lv-mute)', padding: 4, display: 'flex' }}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.color = 'var(--lv-gold)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--lv-mute)' }}
        >
          {reindexing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          title="Remove"
          style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', color: 'var(--lv-mute)', padding: 4, display: 'flex' }}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.color = '#dc2626' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--lv-mute)' }}
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </div>
    </li>
  )
}

// ─── AppearancePanel ──────────────────────────────────────────────────────────

function AppearancePanel() {
  const { uiTheme, setUiTheme, codeTheme, setCodeTheme } = useAppStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── UI Theme ── */}
      <section>
        <SectionLabel>Theme</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { value: 'dark', icon: Moon, label: 'Dark' },
            { value: 'light', icon: Sun, label: 'Light' },
          ] as const).map(({ value, icon: Icon, label }) => {
            const active = uiTheme === value
            return (
              <button
                key={value}
                onClick={() => setUiTheme(value)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 0',
                  border: active
                    ? '1px solid var(--lv-gold)'
                    : '1px solid var(--lv-rule-strong)',
                  background: active ? 'var(--lv-wash)' : 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--lv-gold)' : 'var(--lv-mute)',
                  transition: 'all 0.15s',
                }}
              >
                <Icon size={14} strokeWidth={1.5} />
                {label}
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Code Theme ── */}
      <section>
        <SectionLabel>Code Theme</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {CODE_THEME_OPTIONS.map(({ value, label }) => {
            const active = codeTheme === value
            return (
              <button
                key={value}
                onClick={() => setCodeTheme(value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  border: active
                    ? '1px solid var(--lv-gold)'
                    : '1px solid var(--lv-rule)',
                  background: active ? 'var(--lv-wash)' : 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12.5,
                  color: active ? 'var(--lv-gold)' : 'var(--lv-soft)',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <span>{label}</span>
                {active && (
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    letterSpacing: '0.12em',
                    color: 'var(--lv-gold)',
                    textTransform: 'uppercase',
                  }}>
                    Active
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

    </div>
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
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--lv-mute)',
            marginBottom: 12,
            lineHeight: 1.6,
          }}
        >
          Applied globally to every chat session. Injected into the model&apos;s system instructions
          alongside the base prompt.
        </p>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setSaved(false)
          }}
          placeholder="e.g. Always respond in British English. Be concise."
          rows={10}
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
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--lv-gold)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--lv-rule-strong)'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
          {draft.trim() !== systemPrompt && (
            <button
              onClick={() => {
                setDraft(systemPrompt)
                setSaved(false)
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
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            style={{
              background: saved ? 'transparent' : 'var(--lv-ink)',
              border: saved ? '1px solid var(--lv-gold)' : 'none',
              padding: '6px 18px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 600,
              color: saved ? 'var(--lv-gold)' : 'var(--lv-bg)',
              transition: 'all 0.2s',
            }}
          >
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  )
}

// ─── tiny sub-component ───────────────────────────────────────────────────────

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn('text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3', className)}>
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
