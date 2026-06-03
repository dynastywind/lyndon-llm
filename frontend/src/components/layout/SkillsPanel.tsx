import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Loader2,
  PackagePlus,
  Puzzle,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { deleteSkill, getSkills, toggleSkill, uploadSkill } from '@/api/client'
import type { Skill } from '@/types'

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

// ── skill card ────────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  onToggle,
  onDelete,
}: {
  skill: Skill
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className={`rounded-lg border border-border bg-card transition-opacity ${skill.enabled ? '' : 'opacity-60'}`}>
      {/* header row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={() => setExpanded((x) => !x)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <Puzzle size={14} className="text-muted-foreground shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{skill.name}</span>
            <span className="text-[10px] font-mono text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
              v{skill.version}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {skill.tools.length} {skill.tools.length === 1 ? 'tool' : 'tools'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{skill.description}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* enabled toggle */}
          <label className="relative inline-flex items-center cursor-pointer" title={skill.enabled ? 'Disable' : 'Enable'}>
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
            <div className="flex items-center gap-1.5">
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
              className="text-muted-foreground hover:text-destructive transition-colors"
              aria-label="Delete skill"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* expanded tools list */}
      {expanded && skill.tools.length > 0 && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          {skill.tools.map((tool) => (
            <div key={tool.id} className="flex items-start gap-2 py-1">
              <Code2 size={13} className="text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono">{tool.tool_name}</span>
                  <LangBadge lang={tool.language} />
                </div>
                {tool.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── upload zone ───────────────────────────────────────────────────────────────

function UploadZone({ onUploaded }: { onUploaded: (skill: Skill) => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
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
    const items = e.dataTransfer.items
    if (!items) return
    // If multiple files dropped (folder), use files
    if (e.dataTransfer.files.length > 1) {
      handleFolderFiles(e.dataTransfer.files)
    } else if (e.dataTransfer.files.length === 1) {
      const f = e.dataTransfer.files[0]
      if (f.name.endsWith('.zip')) {
        handleZipFile(f)
      } else {
        setError('Drop a .zip file or use "Upload Folder"')
      }
    }
  }

  return (
    <div className="mb-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg px-6 py-8 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
        }`}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-sm">Installing skill…</span>
          </div>
        ) : (
          <>
            <UploadCloud size={24} className="mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              Drop a <code className="bg-muted px-1 rounded">.zip</code> or drag a folder here
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => zipRef.current?.click()}
                className="text-xs px-3 py-1.5 rounded border border-border bg-background hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <PackagePlus size={13} />
                Upload ZIP
              </button>
              <button
                onClick={() => folderRef.current?.click()}
                className="text-xs px-3 py-1.5 rounded border border-border bg-background hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <UploadCloud size={13} />
                Upload Folder
              </button>
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}

      {/* hidden inputs */}
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
      <p className="text-xs mb-3">Upload a ZIP or folder containing a <code className="bg-muted px-1 rounded">SKILL.md</code> manifest.</p>
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

// ── main component ────────────────────────────────────────────────────────────

export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => { load() }, [load])

  const handleUploaded = (skill: Skill) => {
    setSkills((prev) => {
      const exists = prev.findIndex((s) => s.id === skill.id)
      return exists >= 0
        ? prev.map((s) => (s.id === skill.id ? skill : s))
        : [...prev, skill]
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
      setSkills((prev) => prev.filter((s) => s.id !== id))
    } catch {
      // leave state unchanged on error
    }
  }

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
        <div className="space-y-2">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
