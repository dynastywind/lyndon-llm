import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Trash2 } from 'lucide-react'
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
}

export type SettingsTab = 'profile' | 'ai' | 'knowledge' | 'tools' | 'appearance'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: SettingsTab
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const ACCEPTED = '.pdf,.md,.mdx,.txt,.py,.ts,.tsx,.js,.jsx,.go,.rs,.java,.cpp,.c'
const PAGE_SIZE = 10

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

// NAV SECTIONS
const NAV_SECTIONS: { id: SettingsTab; no: string; label: string }[] = [
  { id: 'profile',    no: '01', label: 'Profile'      },
  { id: 'ai',         no: '02', label: 'AI & Chat'    },
  { id: 'knowledge',  no: '03', label: 'Knowledge'    },
  { id: 'tools',      no: '04', label: 'MCP & Tools'  },
  { id: 'appearance', no: '05', label: 'Appearance'   },
]

// CSS helpers (inline style objects keep us independent of Tailwind here)
const S = {
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.3em',
    textTransform: 'uppercase' as const,
    color: 'var(--lv-gold)',
    display: 'block',
    marginBottom: 16,
  },
  eyebrowMute: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.3em',
    textTransform: 'uppercase' as const,
    color: 'var(--lv-mute)',
    display: 'block',
    marginBottom: 12,
  },
  blockTitle: {
    fontFamily: 'var(--font-display)',
    fontWeight: 400,
    fontSize: 32,
    letterSpacing: '-0.02em',
    margin: 0,
    color: 'var(--lv-ink)',
  },
  kbTitle: {
    fontFamily: 'var(--font-display)',
    fontWeight: 400,
    fontSize: 44,
    letterSpacing: '-0.02em',
    margin: 0,
    color: 'var(--lv-ink)',
    display: 'flex',
    alignItems: 'baseline',
    gap: 18,
    flexWrap: 'wrap' as const,
  },
  rlName: {
    display: 'block',
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--lv-ink)',
    marginBottom: 8,
  },
  rlHint: {
    display: 'block',
    fontSize: 12.5,
    lineHeight: 1.5,
    color: 'var(--lv-mute)',
  },
}

// ─── component ────────────────────────────────────────────────────────────────

export function SettingsDialog({ open, onOpenChange, initialTab = 'profile' }: Props) {
  const {
    user,
    systemPrompt, setSystemPrompt,
    uiTheme, setUiTheme,
    codeTheme, setCodeTheme,
    profession, setProfession,
    avatarDataUrl, setAvatarDataUrl,
  } = useAppStore()

  // ── active section scroll-spy ─────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<SettingsTab>(initialTab)
  const mainRef = useRef<HTMLElement>(null)
  const sectionRefs = useRef<Partial<Record<SettingsTab, HTMLElement | null>>>({})
  const scrollSpyRef = useRef<IntersectionObserver | null>(null)

  // ── save-bar dirty state ─────────────────────────────────────────────────
  const [promptDraft, setPromptDraft] = useState(systemPrompt)
  const [profDraft, setProfDraft] = useState(profession)
  const dirty = promptDraft !== systemPrompt || profDraft !== profession
  const [saveFlash, setSaveFlash] = useState(false)

  // ── avatar state ─────────────────────────────────────────────────────────
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarDragging, setAvatarDragging] = useState(false)
  const [avatarHovered, setAvatarHovered] = useState(false)

  const handleAvatarFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const dataUrl = await resizeImage(file)
    setAvatarDataUrl(dataUrl)
  }

  // ── knowledge state ──────────────────────────────────────────────────────
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── debounce search ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])
  useEffect(() => { setPage(0) }, [debouncedQuery])

  // ── sync drafts whenever the dialog opens (Radix keeps content mounted) ────
  useEffect(() => {
    if (open) {
      setPromptDraft(systemPrompt)
      setProfDraft(profession)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── jump to initial section when opening ──────────────────────────────────
  useEffect(() => {
    if (!open) return
    setActiveSection(initialTab)
    // defer so the DOM is rendered
    setTimeout(() => {
      const el = sectionRefs.current[initialTab]
      if (el && mainRef.current) {
        mainRef.current.scrollTo({ top: el.offsetTop - 48, behavior: 'instant' })
      }
    }, 40)
  }, [open, initialTab])

  // ── scroll spy ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    scrollSpyRef.current?.disconnect()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            const found = NAV_SECTIONS.find((s) => s.id === en.target.id)
            if (found) setActiveSection(found.id)
          }
        })
      },
      { root: mainRef.current, rootMargin: '-25% 0px -60% 0px', threshold: 0 },
    )
    scrollSpyRef.current = observer
    Object.values(sectionRefs.current).forEach((el) => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [open])

  // ── fetch knowledge sources ───────────────────────────────────────────────
  const fetchSources = useCallback(async (pg = page, q = debouncedQuery) => {
    setLoadingSources(true)
    try {
      const res = await listRagSources(PAGE_SIZE, pg * PAGE_SIZE, q)
      setSources(res.sources)
      setTotal(res.total)
    } catch { /* backend may be down */ }
    finally { setLoadingSources(false) }
  }, [page, debouncedQuery])

  useEffect(() => {
    if (open && activeSection === 'knowledge') fetchSources(page, debouncedQuery)
  }, [open, activeSection, page, debouncedQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── uploads ───────────────────────────────────────────────────────────────
  const uploadOne = useCallback(async (item: UploadItem) => {
    setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'uploading' } : i))
    try {
      const result = await uploadRagFile(item.file)
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'done', chunks: result.chunks_stored } : i))
      fetchSources(page, debouncedQuery)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed'
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'error', error: msg } : i))
    }
  }, [fetchSources, page, debouncedQuery])

  const enqueue = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    const items: UploadItem[] = fileArr.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      status: 'checking',
    }))
    setQueue((q) => [...q, ...items])
    for (const item of items) {
      try {
        const { exists } = await checkRagSourceName(item.file.name)
        if (exists) {
          setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'conflict' } : i))
        } else {
          setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'pending' } : i))
          uploadOne({ ...item, status: 'pending' })
        }
      } catch {
        setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'pending' } : i))
        uploadOne({ ...item, status: 'pending' })
      }
    }
  }, [uploadOne])

  const handleReindex = async (src: RagSource) => {
    setReindexing(src.path)
    try {
      const result = await reindexRagSource(src.path)
      setSources((s) => s.map((x) => x.path === src.path ? { ...x, chunks: result.chunks_stored } : x))
    } catch { /* ignore */ }
    finally { setReindexing(null) }
  }

  const handleDelete = async (src: RagSource) => {
    setDeleting(src.path)
    try {
      await deleteRagSource(src.path)
      const newPage = sources.length === 1 && page > 0 ? page - 1 : page
      setPage(newPage)
      fetchSources(newPage, debouncedQuery)
    } catch { /* ignore */ }
    finally { setDeleting(null) }
  }

  // ── save / discard ────────────────────────────────────────────────────────
  const handleSave = () => {
    setSystemPrompt(promptDraft.trim())
    setProfession(profDraft)
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 1600)
  }

  const handleDiscard = () => {
    setPromptDraft(systemPrompt)
    setProfDraft(profession)
  }

  const scrollToSection = (id: SettingsTab) => {
    const el = sectionRefs.current[id]
    if (el && mainRef.current) {
      mainRef.current.scrollTo({ top: el.offsetTop - 48, behavior: 'smooth' })
    }
    setActiveSection(id)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const MAX_PROMPT = 2000

  const setRef = (id: SettingsTab) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Overlay style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 100,
        }} />

        {/* Dialog box */}
        <Dialog.Content
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 101,
            width: 'min(1060px, 95vw)',
            height: 'min(82vh, 800px)',
            background: 'var(--lv-bg)',
            border: '1px solid var(--lv-rule-strong)',
            boxShadow: '0 32px 100px rgba(0,0,0,0.75)',
            color: 'var(--lv-ink)',
            fontFamily: 'var(--font-sans)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
          // prevent Radix from closing on outside click while save bar is dirty
          onInteractOutside={(e) => { if (dirty) e.preventDefault() }}
        >
          {/* Visually-hidden title for screen-readers */}
          <Dialog.Title style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
            Settings
          </Dialog.Title>

          {/* ── Content area (rail + scrollable main) ── */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '256px 1fr', overflow: 'hidden' }}>

      {/* ══════════════════════════ RAIL ══════════════════════════ */}
      <aside style={{
        height: '100%',
        borderRight: '1px solid var(--lv-rule)',
        background: 'var(--lv-bg)',
        display: 'flex',
        flexDirection: 'column',
        padding: '28px 26px',
        overflow: 'hidden',
      }}>
        {/* Brand */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingBottom: 28,
          borderBottom: '1px solid var(--lv-rule)',
        }}>
          {/* Asterisk mark */}
          <svg width={30} height={30} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" style={{ color: 'var(--lv-gold)', flexShrink: 0 }}>
            <line x1="50" y1="39" x2="50" y2="10" /><line x1="59.526" y1="44.5" x2="84.641" y2="30" />
            <line x1="59.526" y1="55.5" x2="84.641" y2="70" /><line x1="50" y1="61" x2="50" y2="90" />
            <line x1="40.474" y1="55.5" x2="15.359" y2="70" /><line x1="40.474" y1="44.5" x2="15.359" y2="30" />
            <circle cx="50" cy="50" r="5.5" fill="currentColor" stroke="none" />
          </svg>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.01em', color: 'var(--lv-ink)' }}>
            Lyndon<em style={{ fontStyle: 'italic', fontWeight: 500, color: 'var(--lv-gold)' }}>LLM</em>
          </span>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 26, flex: 1 }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9.5,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: 'var(--lv-mute)',
            marginBottom: 14,
            paddingLeft: 2,
          }}>
            Settings
          </span>
          {NAV_SECTIONS.map(({ id, no, label }) => {
            const active = activeSection === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => scrollToSection(id)}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                  textDecoration: 'none',
                  color: active ? 'var(--lv-ink)' : 'var(--lv-soft)',
                  fontSize: 15,
                  letterSpacing: '0.01em',
                  padding: '11px 12px',
                  borderRadius: 5,
                  background: active ? 'var(--lv-elev)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'color 0.15s, background 0.15s',
                  width: '100%',
                }}
                onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = 'var(--lv-ink)'; e.currentTarget.style.background = 'var(--lv-elev)' } }}
                onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = 'var(--lv-soft)'; e.currentTarget.style.background = 'transparent' } }}
              >
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9.5,
                  letterSpacing: '0.18em',
                  color: active ? 'var(--lv-gold)' : 'var(--lv-mute)',
                }}>
                  {no}
                </span>
                {label}
              </button>
            )
          })}
        </nav>

      </aside>

      {/* ══════════════════════════ MAIN ══════════════════════════ */}
      <main
        ref={mainRef}
        id="settings-scroller"
        style={{
          overflowY: 'auto',
          padding: '40px 40px 0',
        }}
      >
        {/* Page header */}
        <header style={{ marginBottom: 40 }}>
          <span style={S.eyebrow}>Account — Settings</span>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: 42,
            lineHeight: 1.06,
            letterSpacing: '-0.02em',
            margin: '0 0 0.4em',
            color: 'var(--lv-ink)',
          }}>
            Your <em style={{ fontStyle: 'italic', fontWeight: 500 }}>LLM.</em>
          </h1>
          <p style={{ fontWeight: 300, fontSize: 15, lineHeight: 1.6, color: 'var(--lv-soft)', maxWidth: '52ch', margin: 0 }}>
            Manage how you appear and how LyndonLLM behaves for you.
          </p>
        </header>

        {/* ── 01 · Profile ── */}
        <section
          id="profile"
          ref={setRef('profile')}
          style={{ maxWidth: 760, paddingBottom: 18 }}
        >
          <div style={{ borderTop: '1px solid var(--lv-rule)', paddingTop: 22, marginBottom: 10 }}>
            <span style={S.eyebrowMute}>No. 01 — Identity</span>
            <h2 style={S.blockTitle}>Profile</h2>
          </div>

          {/* Avatar */}
          <SettingsRow label="Avatar" hint="PNG or JPG · square works best · up to 4 MB">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarFile(f); e.target.value = '' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              {/* Tile */}
              <div
                style={{
                  position: 'relative',
                  width: 104, height: 104,
                  borderRadius: 5,
                  background: 'var(--lv-card)',
                  border: `1px solid ${avatarDragging ? 'var(--lv-gold)' : 'var(--lv-rule-strong)'}`,
                  overflow: 'hidden',
                  flexShrink: 0,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onClick={() => avatarInputRef.current?.click()}
                onMouseEnter={() => setAvatarHovered(true)}
                onMouseLeave={() => setAvatarHovered(false)}
                onDragOver={(e) => { e.preventDefault(); setAvatarDragging(true) }}
                onDragLeave={() => setAvatarDragging(false)}
                onDrop={(e) => {
                  e.preventDefault(); setAvatarDragging(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) handleAvatarFile(f)
                }}
              >
                {/* Image or monogram */}
                {avatarDataUrl ? (
                  <img src={avatarDataUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{
                    width: '100%', height: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 500,
                    fontSize: 40, color: 'var(--lv-gold)',
                  }}>
                    {user ? user.username[0].toUpperCase() : '?'}
                  </div>
                )}
                {/* Hover / drag overlay */}
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: 'rgba(10,10,10,0.62)',
                  opacity: avatarHovered || avatarDragging ? 1 : 0,
                  transition: 'opacity 0.2s',
                }}>
                  <span style={{ fontSize: 20, color: 'var(--lv-ink)' }}>↑</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--lv-soft)' }}>
                    {avatarDragging ? 'Drop here' : 'Upload'}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    fontSize: 13, fontWeight: 400,
                    padding: '7px 16px',
                    border: '1px solid var(--lv-rule-strong)',
                    borderRadius: 999,
                    background: 'transparent',
                    color: 'var(--lv-ink)',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--lv-gold)'; e.currentTarget.style.color = 'var(--lv-gold)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--lv-rule-strong)'; e.currentTarget.style.color = 'var(--lv-ink)' }}
                >
                  Change photo
                </button>
                {avatarDataUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarDataUrl(null)}
                    style={{
                      background: 'none', border: 'none', padding: '4px 0',
                      fontFamily: 'var(--font-mono)', fontSize: 10,
                      letterSpacing: '0.2em', textTransform: 'uppercase',
                      color: 'var(--lv-mute)', cursor: 'pointer',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--lv-ink)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--lv-mute)' }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </SettingsRow>

          {/* Username */}
          <SettingsRow label="Username" hint="Permanent — cannot be changed">
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 14,
              padding: '11px 0',
              borderBottom: '1px dashed var(--lv-rule-strong)',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, letterSpacing: '0.04em', color: 'var(--lv-soft)' }}>
                {user?.username ?? '—'}
              </span>
              <span style={{ color: 'var(--lv-mute)', fontSize: 14 }} title="Locked">⦿</span>
            </div>
          </SettingsRow>

          {/* Profession */}
          <SettingsRow label="Profession" hint="Helps tailor responses to your field">
            <input
              type="text"
              list="settings-prof-list"
              value={profDraft}
              onChange={(e) => setProfDraft(e.target.value)}
              placeholder="e.g. Software engineer"
              style={fieldStyle()}
              onFocus={(e) => { e.currentTarget.style.borderBottomColor = 'var(--lv-gold)' }}
              onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'var(--lv-rule-strong)' }}
            />
            <datalist id="settings-prof-list">
              {['Photographer','Software engineer','Designer','Writer','Researcher','Product manager','Student'].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </SettingsRow>
        </section>

        {/* ── 02 · AI & Chat ── */}
        <section
          id="ai"
          ref={setRef('ai')}
          style={{ maxWidth: 760, paddingBottom: 18, marginTop: 22 }}
        >
          <div style={{ borderTop: '1px solid var(--lv-rule)', paddingTop: 22, marginBottom: 10 }}>
            <span style={S.eyebrowMute}>No. 02 — Behaviour</span>
            <h2 style={S.blockTitle}>AI &amp; Chat</h2>
          </div>

          {/* System prompt */}
          <SettingsRow label="System prompt" hint="Standing instructions added to the start of every conversation">
            <textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              maxLength={MAX_PROMPT}
              placeholder="e.g. Be concise and prefer plain language. Cite sources when you can."
              rows={6}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontFamily: 'var(--font-sans)',
                fontSize: 15,
                color: 'var(--lv-ink)',
                background: 'var(--lv-elev)',
                border: '1px solid var(--lv-rule-strong)',
                padding: '15px 16px',
                minHeight: 138,
                lineHeight: 1.6,
                resize: 'vertical',
                borderRadius: 5,
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--lv-gold)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--lv-rule-strong)' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--lv-mute)' }}>
                Markdown supported
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
                color: promptDraft.length > MAX_PROMPT - 200 ? 'var(--lv-gold)' : 'var(--lv-mute)',
              }}>
                {promptDraft.length} / {MAX_PROMPT}
              </span>
            </div>
          </SettingsRow>

          {/* Chat font */}
          <SettingsRow label="Chat font" hint="Typeface used for chat messages">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Font card (Inter only) */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 18,
                background: 'var(--lv-elev)',
                border: '1px solid var(--lv-gold)',
                borderRadius: 5,
                padding: '16px 18px',
              }}>
                <div style={{
                  fontSize: 28, fontWeight: 600,
                  width: 46, height: 46,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--lv-card)',
                  borderRadius: 5,
                  fontFamily: 'Inter, sans-serif',
                  flexShrink: 0,
                }}>Aa</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Inter</span>
                  <span style={{ fontSize: 12, color: 'var(--lv-mute)' }}>Grotesque sans · default</span>
                </div>
                <span style={{ marginLeft: 'auto', color: 'var(--lv-gold)', fontSize: 15 }}>✓</span>
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--lv-mute)', margin: 0, maxWidth: '46ch' }}>
                More typefaces are on the way. Inter is the only chat font available for now.
              </p>

              {/* Chat preview */}
              <div style={{
                marginTop: 8,
                border: '1px solid var(--lv-rule)',
                borderRadius: 5,
                background: 'var(--lv-elev)',
                padding: '20px 20px 24px',
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--lv-mute)', display: 'block', marginBottom: 16 }}>
                  Preview
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 16 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--lv-mute)' }}>You</span>
                  <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 15, lineHeight: 1.6, color: 'var(--lv-soft)' }}>
                    {user?.username ? `What can you tell me about my work history?` : 'How do I set up a Python virtual environment?'}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--lv-gold)' }}>LyndonLLM</span>
                  <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 15, lineHeight: 1.6, color: 'var(--lv-ink)' }}>
                    {promptDraft.trim()
                      ? `Got it — I'll follow your instructions: "${promptDraft.trim().slice(0, 60)}${promptDraft.length > 60 ? '…' : ''}"`
                      : "I'm ready to help. Ask me anything about your work or the world."}
                  </p>
                </div>
              </div>
            </div>
          </SettingsRow>
        </section>

        {/* ── 03 · Knowledge ── */}
        <section
          id="knowledge"
          ref={setRef('knowledge')}
          style={{ maxWidth: 880, paddingBottom: 18, marginTop: 22 }}
        >
          <div style={{ borderTop: '1px solid var(--lv-rule)', paddingTop: 22, marginBottom: 26 }}>
            <span style={{ ...S.eyebrow, marginBottom: 14 }}>No. 03 — Knowledge Base</span>
            <h2 style={S.kbTitle}>
              Documents
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--lv-mute)' }}>
                {total} on file
              </span>
            </h2>
          </div>

          {/* Search + Add */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) enqueue(e.dataTransfer.files) }}
            style={{ outline: dragging ? '2px solid var(--lv-gold)' : 'none', outlineOffset: -2, transition: 'outline 0.15s' }}
          >
            <input ref={fileInputRef} type="file" accept={ACCEPTED} multiple hidden onChange={(e) => { if (e.target.files) enqueue(e.target.files); e.target.value = '' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 8 }}>
              {/* Search */}
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--lv-rule-strong)', transition: 'border-color 0.15s' }}
                onFocusCapture={(e) => { e.currentTarget.style.borderBottomColor = 'var(--lv-gold)' }}
                onBlurCapture={(e) => { e.currentTarget.style.borderBottomColor = 'var(--lv-rule-strong)' }}
              >
                <span style={{ color: 'var(--lv-mute)', fontSize: 17, lineHeight: 1 }}>⌕</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search documents"
                  autoComplete="off"
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: 'var(--font-sans)', fontSize: 16, color: 'var(--lv-ink)', padding: '13px 0' }}
                />
              </label>
              {/* Add document */}
              <KbButton onClick={() => fileInputRef.current?.click()}>Add document →</KbButton>
            </div>

            {/* Upload queue */}
            {queue.length > 0 && (
              <div style={{ paddingTop: 8, borderBottom: '1px solid var(--lv-rule)' }}>
                {queue.map((item) => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 4px', borderTop: '1px solid var(--lv-rule)' }}>
                    <div style={{ width: 64, height: 52, border: '1px solid var(--lv-rule-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', color: 'var(--lv-gold)' }}>{fileExt(item.file.name)}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 18, color: 'var(--lv-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{item.file.name}</div>
                      {item.status === 'conflict' && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--lv-mute)' }}>Already indexed</div>}
                    </div>
                    {item.status === 'checking' && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--lv-mute)', flexShrink: 0 }} />}
                    {item.status === 'uploading' && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--lv-gold)', flexShrink: 0 }} />}
                    {item.status === 'done' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--lv-gold)', flexShrink: 0 }}>
                        <CheckCircle2 size={13} /> {item.chunks} chunks
                      </span>
                    )}
                    {item.status === 'error' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#dc2626', flexShrink: 0 }}>
                        <AlertCircle size={13} /> {item.error}
                      </span>
                    )}
                    {item.status === 'pending' && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--lv-mute)', flexShrink: 0 }}>Queued</span>}
                    {item.status === 'conflict' && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => uploadOne({ ...item, status: 'pending' })} style={smallBtn('gold')}>Replace</button>
                        <button onClick={() => setQueue((q) => q.filter((i) => i.id !== item.id))} style={smallBtn('mute')}>Skip</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Document list */}
            {loadingSources ? (
              <div style={{ padding: '32px 4px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--lv-mute)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em' }}>
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : sources.length === 0 ? (
              <p style={{ padding: '22px 4px', fontSize: 14, color: 'var(--lv-mute)', margin: 0 }}>
                {debouncedQuery ? 'No documents match your search.' : 'No documents indexed yet.'}
              </p>
            ) : (
              <>
                <ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0 }}>
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
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 4px', borderTop: '1px solid var(--lv-rule)' }}>
                    <PagBtn disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev</PagBtn>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', color: 'var(--lv-mute)', textTransform: 'uppercase' }}>{page + 1} / {totalPages}</span>
                    <PagBtn disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Next →</PagBtn>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── 04 · MCP & Tools ── */}
        <section
          id="tools"
          ref={setRef('tools')}
          style={{ maxWidth: 880, paddingBottom: 18, marginTop: 22 }}
        >
          <div style={{ borderTop: '1px solid var(--lv-rule)', paddingTop: 22, marginBottom: 26 }}>
            <span style={{ ...S.eyebrow, marginBottom: 14 }}>No. 04 — Model Context Protocol</span>
            <h2 style={S.kbTitle}>MCP &amp; Tools</h2>
          </div>
          {/* Wrap existing ToolsRegistryPanel */}
          <ToolsRegistryPanel active={open && activeSection === 'tools'} />
        </section>

        {/* ── 05 · Appearance ── */}
        <section
          id="appearance"
          ref={setRef('appearance')}
          style={{ maxWidth: 760, paddingBottom: 18, marginTop: 22 }}
        >
          <div style={{ borderTop: '1px solid var(--lv-rule)', paddingTop: 22, marginBottom: 10 }}>
            <span style={S.eyebrowMute}>No. 05 — Surface</span>
            <h2 style={S.blockTitle}>Appearance</h2>
          </div>

          {/* Theme */}
          <SettingsRow label="Theme" hint="Applies across the whole interface, instantly">
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {([
                { value: 'dark' as const, label: 'Dark', barColor: '#c8a86a', lineColor: '#2c2c2c', bgColor: '#0a0a0a', borderColor: '#232323' },
                { value: 'light' as const, label: 'Light', barColor: '#9a7a30', lineColor: '#d8d1c1', bgColor: '#f4f1ea', borderColor: '#ddd6c6' },
              ]).map(({ value, label, barColor, lineColor, bgColor, borderColor }) => {
                const active = uiTheme === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setUiTheme(value)}
                    role="radio"
                    aria-checked={active}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${active ? 'var(--lv-gold)' : 'var(--lv-rule-strong)'}`,
                      borderRadius: 5,
                      padding: 12,
                      width: 168,
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--lv-soft)' }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--lv-rule-strong)' }}
                  >
                    {/* Mini preview art */}
                    <div style={{ height: 96, borderRadius: 3, padding: 16, marginBottom: 12, background: bgColor, border: `1px solid ${borderColor}`, overflow: 'hidden' }}>
                      <div style={{ height: 7, width: 38, borderRadius: 2, background: barColor, marginBottom: 12 }} />
                      <div style={{ height: 5, borderRadius: 2, background: lineColor, marginBottom: 7 }} />
                      <div style={{ height: 5, width: '62%', borderRadius: 2, background: lineColor }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--lv-ink)' }}>{label}</span>
                      {/* Radio dot */}
                      <div style={{
                        width: 14, height: 14, borderRadius: '50%',
                        border: `1px solid ${active ? 'var(--lv-gold)' : 'var(--lv-rule-strong)'}`,
                        position: 'relative',
                      }}>
                        {active && (
                          <div style={{ position: 'absolute', inset: 3, background: 'var(--lv-gold)', borderRadius: '50%' }} />
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </SettingsRow>

          {/* Code theme */}
          <SettingsRow label="Code theme" hint="Syntax highlighting style in code blocks">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CODE_THEME_OPTIONS.map(({ value, label }) => {
                const active = codeTheme === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCodeTheme(value)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px',
                      border: `1px solid ${active ? 'var(--lv-gold)' : 'var(--lv-rule)'}`,
                      background: active ? 'var(--lv-elev)' : 'transparent',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 14,
                      color: active ? 'var(--lv-gold)' : 'var(--lv-soft)',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                      borderRadius: 5,
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--lv-rule-strong)' }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--lv-rule)' }}
                  >
                    <span>{label}</span>
                    {active && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--lv-gold)', textTransform: 'uppercase' }}>Active</span>
                    )}
                  </button>
                )
              })}
            </div>
          </SettingsRow>
        </section>

        {/* Bottom spacer */}
        <div style={{ height: 100 }} />
      </main>

          </div>{/* end content grid */}

          {/* ══════════════════════════ SAVE BAR ══════════════════════════ */}
          <div style={{
            maxHeight: dirty ? 64 : 0,
            opacity: dirty ? 1 : 0,
            overflow: 'hidden',
            transition: 'max-height 0.25s cubic-bezier(.2,.8,.2,1), opacity 0.2s ease',
            borderTop: '1px solid var(--lv-rule)',
            background: 'var(--lv-bg)',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 20,
              padding: '14px 28px',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: saveFlash ? '#4ade80' : 'var(--lv-gold)', transition: 'background 0.3s' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--lv-soft)' }}>
                  Unsaved changes
                </span>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <button
                  type="button"
                  onClick={handleDiscard}
                  style={{
                    background: 'none', border: 'none',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5, letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: 'var(--lv-mute)', cursor: 'pointer', padding: '0.5rem 0.2rem',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--lv-ink)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--lv-mute)' }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    fontSize: 13, fontWeight: 500, letterSpacing: '0.03em',
                    padding: '0.6rem 1.2rem',
                    borderRadius: 999,
                    border: '1px solid var(--lv-ink)',
                    background: 'var(--lv-ink)',
                    color: 'var(--lv-bg)',
                    cursor: 'pointer',
                    transition: 'background 0.2s, border-color 0.2s, color 0.2s, transform 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--lv-gold)'; e.currentTarget.style.borderColor = 'var(--lv-gold)'; e.currentTarget.style.color = '#0a0a0a'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--lv-ink)'; e.currentTarget.style.borderColor = 'var(--lv-ink)'; e.currentTarget.style.color = 'var(--lv-bg)'; e.currentTarget.style.transform = 'none' }}
                >
                  Save changes →
                </button>
              </div>
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── SettingsRow ──────────────────────────────────────────────────────────────

function SettingsRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '210px 1fr',
      gap: 40,
      padding: '30px 0',
      borderBottom: '1px solid var(--lv-rule)',
    }}>
      <div style={{ paddingTop: 4 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: 'var(--lv-ink)', marginBottom: 8 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12.5, lineHeight: 1.5, color: 'var(--lv-mute)' }}>{hint}</span>
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
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
        display: 'grid',
        gridTemplateColumns: '64px 1fr auto',
        alignItems: 'center',
        gap: 26,
        padding: '20px 4px',
        borderTop: '1px solid var(--lv-rule)',
        background: hov ? 'var(--lv-elev)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* Badge */}
      <div style={{
        width: 64, height: 52,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${hov ? 'var(--lv-rule-strong)' : 'var(--lv-rule)'}`,
        transition: 'border-color 0.15s',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', color: 'var(--lv-gold)', textTransform: 'uppercase' }}>
          {ext.slice(0, 4)}
        </span>
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 18, color: 'var(--lv-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={src.path}>
          {src.name}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--lv-mute)' }}>
          {meta}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, opacity: hov ? 1 : 0, transition: 'opacity 0.15s', flexShrink: 0 }}>
        <button onClick={onReindex} disabled={busy} title="Re-index"
          style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', color: 'var(--lv-mute)', padding: 4, display: 'flex' }}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.color = 'var(--lv-gold)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--lv-mute)' }}
        >
          {reindexing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
        <button onClick={onDelete} disabled={busy} title="Remove"
          style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', color: 'var(--lv-mute)', padding: 4, display: 'flex' }}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.color = '#dc2626' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--lv-mute)' }}
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
    </li>
  )
}

// ─── tiny helpers ─────────────────────────────────────────────────────────────

function fieldStyle(): React.CSSProperties {
  return {
    width: '100%',
    fontFamily: 'var(--font-sans)',
    fontSize: 15,
    color: 'var(--lv-ink)',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--lv-rule-strong)',
    padding: '11px 0',
    outline: 'none',
    transition: 'border-color 0.15s',
  }
}

function KbButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '0.85rem 1.6rem',
        border: '1px solid var(--lv-rule-strong)',
        borderRadius: 999,
        background: 'transparent',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5, letterSpacing: '0.2em', textTransform: 'uppercase',
        color: 'var(--lv-ink)',
        whiteSpace: 'nowrap',
        transition: 'border-color 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--lv-gold)'; e.currentTarget.style.color = 'var(--lv-gold)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--lv-rule-strong)'; e.currentTarget.style.color = 'var(--lv-ink)' }}
    >
      {children}
    </button>
  )
}

function PagBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: disabled ? 'var(--lv-rule-strong)' : 'var(--lv-mute)',
        background: 'none', border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        padding: 0, transition: 'color 0.15s',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = 'var(--lv-gold)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = disabled ? 'var(--lv-rule-strong)' : 'var(--lv-mute)' }}
    >
      {children}
    </button>
  )
}

function resizeImage(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = reject
    img.src = url
  })
}

function smallBtn(variant: 'gold' | 'mute'): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: variant === 'gold' ? 'var(--lv-gold)' : 'var(--lv-mute)',
    background: 'none',
    border: `1px solid ${variant === 'gold' ? 'var(--lv-gold)' : 'var(--lv-rule-strong)'}`,
    padding: '3px 10px', cursor: 'pointer',
  }
}
