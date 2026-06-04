import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, ChevronDown, Code2, Copy, Loader2, PackagePlus, Puzzle, Trash2, UploadCloud, X } from 'lucide-react'
import { deleteSkill, getSkills, toggleSkill, uploadSkill } from '@/api/client'
import type { Skill, SkillToolDef } from '@/types'

// ── language badge colours ────────────────────────────────────────────────────

const LANG_COLOURS: Record<string, string> = {
  python: 'bg-blue-500/15 text-blue-400',
  javascript: 'bg-yellow-500/15 text-yellow-400',
  typescript: 'bg-blue-400/15 text-blue-300',
  bash: 'bg-green-500/15 text-green-400',
  ruby: 'bg-red-500/15 text-red-400',
  go: 'bg-cyan-500/15 text-cyan-400',
  rust: 'bg-orange-500/15 text-orange-400',
}

function LangBadge({ lang }: { lang: string }) {
  const cls = LANG_COLOURS[lang.toLowerCase()] ?? 'bg-muted text-muted-foreground'
  return (
    <span className={`text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded ${cls}`}>
      {lang}
    </span>
  )
}

// ── SKILL.md modal ────────────────────────────────────────────────────────────

function SkillMdModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const markdown = skill.skill_md || `# ${skill.name}\n\nNo SKILL.md content stored for this skill.`

  const copy = () => {
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" style={{ zIndex: 200 }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl focus:outline-none"
          style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column', zIndex: 201 }}
        >
          <Dialog.Title className="sr-only">{skill.name} — SKILL.md</Dialog.Title>
          {/* header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Puzzle size={14} className="text-muted-foreground" />
              <span className="text-sm font-medium">{skill.name}</span>
              <span className="text-[10px] font-mono text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
                v{skill.version}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copy}
                className="text-xs flex items-center gap-1.5 px-2 py-1 rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
              >
                {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <Dialog.Close asChild>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* code body */}
          <div className="overflow-auto flex-1 p-4">
            <pre className="text-[12px] font-mono text-foreground/90 whitespace-pre leading-relaxed">
              {markdown}
            </pre>
          </div>

          {/* tools summary */}
          {skill.tools.length > 0 && (
            <div className="border-t border-border px-4 py-3 shrink-0">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Tools
              </p>
              <div className="space-y-1.5">
                {skill.tools.map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <Code2 size={12} className="text-muted-foreground shrink-0" />
                    <span className="text-xs font-mono">{t.tool_name}</span>
                    <LangBadge lang={t.language} />
                    {t.description && (
                      <span className="text-xs text-muted-foreground truncate">{t.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── skill card ────────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  onToggle,
  onDelete,
  onViewMarkdown,
}: {
  skill: Skill
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  onViewMarkdown: (skill: Skill) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div
      className={`rounded-lg border border-border bg-card transition-opacity ${skill.enabled ? '' : 'opacity-60'}`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Puzzle size={14} className="text-muted-foreground shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Clicking name opens SKILL.md modal */}
            <button
              onClick={() => onViewMarkdown(skill)}
              className="text-sm font-medium hover:underline underline-offset-2 text-left truncate"
            >
              {skill.name}
            </button>
            <span className="text-[10px] font-mono text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
              v{skill.version}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {skill.tools.length} {skill.tools.length === 1 ? 'tool' : 'tools'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{skill.description}</p>
        </div>

        {/* tool language badges — always visible */}
        {skill.tools.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            {skill.tools.slice(0, 3).map((t: SkillToolDef) => (
              <LangBadge key={t.id} lang={t.language} />
            ))}
            {skill.tools.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{skill.tools.length - 3}</span>
            )}
          </div>
        )}

        {/* enabled toggle */}
        <label
          className="relative inline-flex items-center cursor-pointer shrink-0"
          title={skill.enabled ? 'Disable' : 'Enable'}
        >
          <input
            type="checkbox"
            className="sr-only peer"
            checked={skill.enabled}
            onChange={(e) => onToggle(skill.id, e.target.checked)}
          />
          <div className="w-8 h-4 rounded-full bg-muted peer-checked:bg-green-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4" />
        </label>

        {/* delete */}
        {confirmDelete ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-destructive">Delete?</span>
            <button
              onClick={() => onDelete(skill.id)}
              className="text-xs bg-destructive text-destructive-foreground px-2 py-0.5 rounded hover:opacity-80"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
            aria-label="Delete skill"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── upload zone ───────────────────────────────────────────────────────────────

function UploadZone({ onUploaded }: { onUploaded: (skill: Skill) => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  const doUpload = useCallback(
    async (fd: FormData) => {
      setUploading(true)
      setError(null)
      try {
        const skill = await uploadSkill(fd)
        onUploaded(skill)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [onUploaded],
  )

  const handleZipFile = (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    doUpload(fd)
  }

  const handleFolderFiles = (fileList: FileList) => {
    const fd = new FormData()
    for (const f of fileList) {
      fd.append('files', f, f.webkitRelativePath || f.name)
    }
    doUpload(fd)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 1) {
      handleFolderFiles(e.dataTransfer.files)
    } else if (e.dataTransfer.files.length === 1) {
      const f = e.dataTransfer.files[0]
      if (f.name.endsWith('.zip')) {
        handleZipFile(f)
      } else {
        setError('Drop a .zip file or a folder')
      }
    }
  }

  return (
    <div
      className="mb-6"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-3">
        {/* Compact dropdown button */}
        <div className="relative">
          <button
            type="button"
            disabled={uploading}
            onClick={() => !uploading && setMenuOpen((x) => !x)}
            className="text-xs px-3 py-1.5 rounded border border-border bg-background hover:bg-muted transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"
          >
            {uploading ? (
              <><Loader2 size={13} className="animate-spin" /> Installing…</>
            ) : (
              <><UploadCloud size={13} /> Upload Skill <ChevronDown size={11} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} /></>
            )}
          </button>
          {menuOpen && (
            <div className="absolute top-full mt-1 z-10 w-36 rounded border border-border bg-card shadow-md overflow-hidden">
              <button
                onClick={() => { setMenuOpen(false); zipRef.current?.click() }}
                className="w-full text-left text-xs px-3 py-2 flex items-center gap-2 hover:bg-muted transition-colors"
              >
                <PackagePlus size={12} /> ZIP file
              </button>
              <button
                onClick={() => { setMenuOpen(false); folderRef.current?.click() }}
                className="w-full text-left text-xs px-3 py-2 flex items-center gap-2 hover:bg-muted transition-colors border-t border-border"
              >
                <UploadCloud size={12} /> Folder
              </button>
            </div>
          )}
        </div>
        {dragging && (
          <span className="text-xs text-muted-foreground animate-pulse">Drop to install…</span>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <input
        ref={zipRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleZipFile(f)
          e.target.value = ''
        }}
      />
      <input
        ref={folderRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleFolderFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ── empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <Puzzle size={32} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm font-medium mb-1">No skills installed</p>
      <p className="text-xs mb-3">
        Upload a ZIP or folder containing a{' '}
        <code className="bg-muted px-1 rounded">SKILL.md</code> manifest.
      </p>
      <details className="text-left max-w-sm mx-auto">
        <summary className="text-xs cursor-pointer hover:text-foreground select-none">
          SKILL.md format
        </summary>
        <pre className="mt-2 text-[11px] bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap">{`---
name: my-skill
description: What this skill does and when to invoke it
version: "1.0"
tools:
  - name: my_tool
    description: Describe what this tool does
    language: python
    script: my_tool.py
    parameters:
      - name: input
        type: string
        description: Input value
        required: true
---`}</pre>
      </details>
    </div>
  )
}

// ── pagination ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 5

function Pagination({
  page,
  total,
  onChange,
}: {
  page: number
  total: number
  onChange: (p: number) => void
}) {
  const pages = Math.ceil(total / PAGE_SIZE)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 0}
        className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        ← Prev
      </button>
      <span>
        {page + 1} / {pages}
        <span className="ml-2 opacity-60">({total} skills)</span>
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= pages - 1}
        className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Next →
      </button>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getSkills()
      setSkills(data)
    } catch {
      setError('Failed to load skills')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleUploaded = (skill: Skill) => {
    setSkills((prev) => {
      // Match by name so a replaced skill lands on the same slot
      const exists = prev.findIndex((s) => s.name === skill.name)
      const next =
        exists >= 0 ? prev.map((s) => (s.name === skill.name ? skill : s)) : [...prev, skill]
      const idx = next.findIndex((s) => s.id === skill.id)
      setPage(Math.floor(idx / PAGE_SIZE))
      return next
    })
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const updated = await toggleSkill(id, enabled)
      setSkills((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch {
      // leave state unchanged on error
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteSkill(id)
      setSkills((prev) => {
        const next = prev.filter((s) => s.id !== id)
        const maxPage = Math.max(0, Math.ceil(next.length / PAGE_SIZE) - 1)
        setPage((p) => Math.min(p, maxPage))
        return next
      })
    } catch {
      // leave state unchanged on error
    }
  }

  const pageSkills = skills.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div>
      <UploadZone onUploaded={handleUploaded} />

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : skills.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="space-y-2">
            {pageSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onViewMarkdown={setActiveSkill}
              />
            ))}
          </div>
          <Pagination page={page} total={skills.length} onChange={setPage} />
        </>
      )}

      {activeSkill && <SkillMdModal skill={activeSkill} onClose={() => setActiveSkill(null)} />}
    </div>
  )
}
