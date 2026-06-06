// Projects list page — the landing surface for a mode's projects.

import { useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { createProject, deleteProject, updateProject } from '@/api/client'
import { useProjects } from '@/hooks/useProjects'
import type { Mode, Project } from '@/types'
import { IconArchive, IconDots, IconEdit, IconPushpin, IconSearch, IconSort } from './icons'
import { ContextMenu, Modal, Toast } from './ui'
import { relTime } from './util'
import './projects.css'

/** Subsequence fuzzy match: every char of `query` appears in `text` in order. */
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  const t = text.toLowerCase()
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i === q.length) return true
  }
  return false
}

function ProjectCard({
  project,
  onClick,
  onMore,
  menuOpen,
}: {
  project: Project
  onClick: () => void
  onMore: (e: React.MouseEvent) => void
  menuOpen: boolean
}) {
  return (
    <div
      className="p-project-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick()
      }}
    >
      <button
        className={`p-card-more ${menuOpen ? 'is-open' : ''}`}
        title="More options"
        onClick={(e) => {
          e.stopPropagation()
          onMore(e)
        }}
      >
        <IconDots />
      </button>
      <div>
        <div className="p-card-name">{project.name}</div>
        <div className="p-card-desc">{project.instructions ?? ''}</div>
      </div>
      <div className="p-card-meta">
        <span className="p-card-date">{relTime(project.updated_at)}</span>
        <span className="p-card-count">
          {project.chat_count} chat{project.chat_count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}

export function ProjectsWindow() {
  const mode = useAppStore((s) => s.mode)
  const projectMode: Mode = mode === 'sandbox' ? 'chat' : mode
  const { projects } = useProjects(projectMode)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId)
  const sortBy = useAppStore((s) => s.projectSort)
  const setSortBy = useAppStore((s) => s.setProjectSort)
  const bumpProjectVersion = useAppStore((s) => s.bumpProjectVersion)
  const pinnedProjectIds = useAppStore((s) => s.pinnedProjectIds)
  const pinProject = useAppStore((s) => s.pinProject)
  const unpinProject = useAppStore((s) => s.unpinProject)

  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; project: Project } | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newInstructions, setNewInstructions] = useState('')
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [editName, setEditName] = useState('')
  const [editInstructions, setEditInstructions] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [searchActive, setSearchActive] = useState(false)
  const [query, setQuery] = useState('')

  // Sort by the active sort, filter by the project-name fuzzy query, then split
  // into Pinned and the rest.
  const { favorites, others } = useMemo(() => {
    const list = [...projects].filter((p) => fuzzyMatch(query, p.name))
    if (sortBy === 'alpha') {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    } else if (sortBy === 'created') {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at))
    } else {
      list.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    }
    return {
      favorites: list.filter((p) => pinnedProjectIds.includes(p.id)),
      others: list.filter((p) => !pinnedProjectIds.includes(p.id)),
    }
  }, [projects, sortBy, pinnedProjectIds, query])

  const hasAny = favorites.length > 0 || others.length > 0

  const openProject = (id: string) => {
    setActiveProjectId(id)
    setActiveView('projectDetail')
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const project = await createProject(projectMode, newName.trim(), newInstructions.trim())
      setNewName('')
      setNewInstructions('')
      setShowNew(false)
      bumpProjectVersion()
      setToast('Project created')
      openProject(project.id)
    } catch {
      setToast('Could not create project')
    }
  }

  const toggleFavorite = (project: Project) => {
    setCardMenu(null)
    if (pinnedProjectIds.includes(project.id)) unpinProject(project.id)
    else pinProject(project.id)
  }

  const openEdit = (project: Project) => {
    setCardMenu(null)
    setEditProject(project)
    setEditName(project.name)
    setEditInstructions(project.instructions ?? '')
  }

  const saveEdit = async () => {
    if (!editProject || !editName.trim()) return
    try {
      await updateProject(editProject.id, {
        name: editName.trim(),
        instructions: editInstructions.trim(),
      })
      setEditProject(null)
      bumpProjectVersion()
      setToast('Project updated')
    } catch {
      setToast('Could not update project')
    }
  }

  const archive = async (project: Project) => {
    setArchiveTarget(null)
    try {
      await deleteProject(project.id)
      bumpProjectVersion()
      setToast(`"${project.name}" archived`)
    } catch {
      setToast('Could not archive project')
    }
  }

  const sortOptions: { value: 'recent' | 'created' | 'alpha'; label: string }[] = [
    { value: 'recent', label: 'Recent' },
    { value: 'created', label: 'Created' },
    { value: 'alpha', label: 'Alphabetical' },
  ]

  const renderCard = (p: Project) => (
    <ProjectCard
      key={p.id}
      project={p}
      onClick={() => openProject(p.id)}
      menuOpen={cardMenu?.project.id === p.id}
      onMore={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        setCardMenu({ x: r.right, y: r.bottom + 4, project: p })
      }}
    />
  )

  return (
    <div className="p-app">
      <div className="p-main">
        <div className="p-view">
          <div className="p-list">
            <div className="p-list-header">
              <h1 className="p-list-title">Projects</h1>
              <div className="p-list-actions">
                <button
                  className="p-icon-btn"
                  title="Sort"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setSortMenu({ x: r.left, y: r.bottom + 6 })
                  }}
                >
                  <IconSort />
                </button>
                <button
                  className={`p-icon-btn ${searchActive ? 'is-active' : ''}`}
                  title="Search projects"
                  onClick={() => {
                    setSearchActive((v) => {
                      if (v) setQuery('')
                      return !v
                    })
                  }}
                >
                  <IconSearch />
                </button>
                <button className="p-btn" onClick={() => setShowNew(true)}>
                  New project
                </button>
              </div>
            </div>

            {searchActive && (
              <div className="p-list-search">
                <IconSearch />
                <input
                  autoFocus
                  className="p-list-search-input"
                  placeholder="Search projects by name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setQuery('')
                      setSearchActive(false)
                    }
                  }}
                />
              </div>
            )}

            {hasAny ? (
              <>
                {favorites.length > 0 && (
                  <>
                    <div className="p-section-label">
                      Pinned
                      <span className="p-section-label-line" />
                    </div>
                    <div className="p-grid" style={{ marginBottom: '2rem' }}>
                      {favorites.map(renderCard)}
                    </div>
                  </>
                )}
                {others.length > 0 && (
                  <>
                    {favorites.length > 0 && (
                      <div className="p-section-label">
                        All projects
                        <span className="p-section-label-line" />
                      </div>
                    )}
                    <div className="p-grid">{others.map(renderCard)}</div>
                  </>
                )}
              </>
            ) : query.trim() ? (
              <div className="p-empty">
                <div className="p-empty-title">No matching projects</div>
                <div className="p-empty-desc">No project name matches “{query.trim()}”.</div>
              </div>
            ) : (
              <div className="p-empty">
                <div className="p-empty-title">No projects yet</div>
                <div className="p-empty-desc">
                  Group related chats under a shared brief and context. Create your first project to
                  get started.
                </div>
                <button className="p-btn p-btn--ghost p-btn--sm" onClick={() => setShowNew(true)}>
                  New project <span className="p-arrow">→</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {sortMenu && (
        <ContextMenu x={sortMenu.x} y={sortMenu.y} onClose={() => setSortMenu(null)}>
          <div className="p-context-sub">Sort by</div>
          {sortOptions.map((opt) => (
            <button
              key={opt.value}
              className="p-context-item"
              style={sortBy === opt.value ? { color: 'var(--lv-gold)' } : undefined}
              onClick={() => {
                setSortBy(opt.value)
                setSortMenu(null)
              }}
            >
              {sortBy === opt.value && <span style={{ fontSize: '.7rem' }}>✓</span>}
              {opt.label}
            </button>
          ))}
        </ContextMenu>
      )}

      {/* Per-card menu: Pin (favorite) / Edit details / Archive */}
      {cardMenu && (
        <ContextMenu x={cardMenu.x} y={cardMenu.y} onClose={() => setCardMenu(null)}>
          <button className="p-context-item" onClick={() => toggleFavorite(cardMenu.project)}>
            <IconPushpin />
            {pinnedProjectIds.includes(cardMenu.project.id) ? 'Unpin' : 'Pin'}
          </button>
          <button className="p-context-item" onClick={() => openEdit(cardMenu.project)}>
            <IconEdit /> Edit details
          </button>
          <div className="p-context-sep" />
          <button
            className="p-context-item p-context-item--danger"
            onClick={() => {
              setArchiveTarget(cardMenu.project)
              setCardMenu(null)
            }}
          >
            <IconArchive /> Archive
          </button>
        </ContextMenu>
      )}

      {showNew && (
        <Modal
          onClose={() => {
            setShowNew(false)
            setNewName('')
            setNewInstructions('')
          }}
        >
          <div className="p-modal-title">New Project</div>
          <div className="p-modal-desc">Give your project a name and optional instructions.</div>
          <input
            className="p-modal-input"
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <textarea
            className="p-modal-input"
            placeholder="Instructions (optional) — e.g. project goals, constraints, preferences…"
            value={newInstructions}
            onChange={(e) => setNewInstructions(e.target.value)}
            rows={3}
            style={{ marginTop: '1rem', resize: 'vertical', lineHeight: 1.5, fontSize: '.88rem' }}
          />
          <div className="p-modal-actions">
            <button
              className="p-btn p-btn--ghost p-btn--sm"
              onClick={() => {
                setShowNew(false)
                setNewName('')
                setNewInstructions('')
              }}
            >
              Cancel
            </button>
            <button className="p-btn p-btn--sm" onClick={handleCreate} disabled={!newName.trim()}>
              Create <span className="p-arrow">→</span>
            </button>
          </div>
        </Modal>
      )}

      {/* Edit details — same form as create */}
      {editProject && (
        <Modal onClose={() => setEditProject(null)}>
          <div className="p-modal-title">Edit Project</div>
          <div className="p-modal-desc">Update the project name and instructions.</div>
          <input
            className="p-modal-input"
            placeholder="Project name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            autoFocus
          />
          <textarea
            className="p-modal-input"
            placeholder="Instructions (optional) — e.g. project goals, constraints, preferences…"
            value={editInstructions}
            onChange={(e) => setEditInstructions(e.target.value)}
            rows={3}
            style={{ marginTop: '1rem', resize: 'vertical', lineHeight: 1.5, fontSize: '.88rem' }}
          />
          <div className="p-modal-actions">
            <button className="p-btn p-btn--ghost p-btn--sm" onClick={() => setEditProject(null)}>
              Cancel
            </button>
            <button className="p-btn p-btn--sm" onClick={saveEdit} disabled={!editName.trim()}>
              Save
            </button>
          </div>
        </Modal>
      )}

      {/* Archive (delete) confirmation */}
      {archiveTarget && (
        <Modal onClose={() => setArchiveTarget(null)}>
          <div className="p-modal-title">Archive Project</div>
          <div className="p-modal-desc">
            Archive “{archiveTarget.name}”? Its chats return to Recents. This removes the project
            and its shared instructions and files.
          </div>
          <div className="p-modal-actions">
            <button className="p-btn p-btn--ghost p-btn--sm" onClick={() => setArchiveTarget(null)}>
              Cancel
            </button>
            <button
              className="p-btn p-btn--sm"
              style={{ background: '#e85a5a', borderColor: '#e85a5a' }}
              onClick={() => archive(archiveTarget)}
            >
              Archive
            </button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
