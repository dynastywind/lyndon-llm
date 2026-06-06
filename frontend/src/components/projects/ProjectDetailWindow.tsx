// Project detail page — composer, chat list, and the Instructions / Scheduled /
// Context sidebar panels.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Image as ImageIcon, X } from 'lucide-react'
import {
  deleteChatSession,
  deleteProject,
  deleteProjectFile,
  getProject,
  listChatSessions,
  listProjectFiles,
  listProjectSessions,
  listProjects,
  moveSessionToProject,
  updateProject,
  uploadProjectFile,
} from '@/api/client'
import { useStream } from '@/hooks/useStream'
import { useAppStore } from '@/store'
import type {
  ChatSession,
  MessageAttachment,
  Mode,
  Project,
  ProjectFile,
  ProjectFolder,
} from '@/types'
import {
  IconArrowLeft,
  IconChat,
  IconDots,
  IconFolder,
  IconMemory,
  IconMove,
  IconPin,
  IconPlus,
  IconSend,
  IconTrash,
} from './icons'
import { ContextMenu, Modal, SidebarPanel, Toast } from './ui'
import { ModelEffortSelector } from './ModelEffortSelector'
import { relTime } from './util'
import './projects.css'

/** File types the composer accepts as message attachments (mirrors the chat input). */
const ATTACH_ACCEPT =
  'image/*,.pdf,.txt,.md,.csv,.json,.py,.ts,.tsx,.js,.jsx,.java,.cpp,.c,.go,.rs,.html,.css'

interface LocalAttachment {
  id: string
  file: File
  previewUrl: string | null
}

/** Read a file into a full data URL ("data:<type>;base64,…"). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function ChatItem({
  session,
  onOpen,
  onMore,
}: {
  session: ChatSession
  onOpen: () => void
  onMore: (e: React.MouseEvent, s: ChatSession) => void
}) {
  return (
    <div className="p-chat-item" onClick={onOpen}>
      <div className="p-chat-icon">
        <IconChat />
      </div>
      <div className="p-chat-info">
        <div className="p-chat-title">{session.title ?? 'Untitled chat'}</div>
        <div className="p-chat-preview">{relTime(session.updated_at)}</div>
      </div>
      <button
        className="p-chat-more"
        title="More options"
        onClick={(e) => {
          e.stopPropagation()
          onMore(e, session)
        }}
      >
        ···
      </button>
    </div>
  )
}

export function ProjectDetailWindow() {
  const mode = useAppStore((s) => s.mode)
  const projectMode: Mode = mode === 'sandbox' ? 'chat' : mode
  const projectId = useAppStore((s) => s.activeProjectId)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId)
  const setSessionId = useAppStore((s) => s.setSessionId)
  const setSessionTitle = useAppStore((s) => s.setSessionTitle)
  const setPendingProjectId = useAppStore((s) => s.setPendingProjectId)
  const bumpProjectVersion = useAppStore((s) => s.bumpProjectVersion)
  const bumpSessionVersion = useAppStore((s) => s.bumpSessionVersion)
  const pinnedProjectIds = useAppStore((s) => s.pinnedProjectIds)
  const pinProject = useAppStore((s) => s.pinProject)
  const unpinProject = useAppStore((s) => s.unpinProject)
  const { send } = useStream()

  const [project, setProject] = useState<Project | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [others, setOthers] = useState<Project[]>([])
  const [chatMenu, setChatMenu] = useState<{ x: number; y: number; session: ChatSession } | null>(
    null,
  )
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null)
  const [showAddChat, setShowAddChat] = useState(false)
  const [candidates, setCandidates] = useState<ChatSession[]>([])
  const [editingInstr, setEditingInstr] = useState(false)
  const [instrDraft, setInstrDraft] = useState('')
  const [input, setInput] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmDeleteChat, setConfirmDeleteChat] = useState<ChatSession | null>(null)
  const [msgAttachments, setMsgAttachments] = useState<LocalAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const msgFileRef = useRef<HTMLInputElement>(null)

  const isPinned = projectId ? pinnedProjectIds.includes(projectId) : false

  // Detail view shows no chat — clear the active session so the in-detail
  // composer's useStream creates a fresh session (filed under this project).
  useEffect(() => {
    setSessionId(null)
  }, [setSessionId])

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const [p, s, f, all] = await Promise.all([
        getProject(projectId),
        listProjectSessions(projectId),
        listProjectFiles(projectId).catch(() => ({ files: [] })),
        listProjects(projectMode).catch(() => ({ projects: [] })),
      ])
      setProject(p)
      setSessions(s.sessions)
      setFiles(f.files)
      setOthers(all.projects.filter((x) => x.id !== projectId))
    } catch {
      // project missing / backend down — bounce back to the list
      setActiveView('projectsList')
    }
  }, [projectId, projectMode, setActiveView])

  useEffect(() => {
    load()
  }, [load])

  if (!projectId || !project) {
    return (
      <div className="p-app">
        <div className="p-main">
          <div className="p-view">
            <div className="p-loading">Loading…</div>
          </div>
        </div>
      </div>
    )
  }

  const goBack = () => {
    setActiveProjectId(null)
    setActiveView('projectsList')
  }

  const onMsgFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setMsgAttachments((prev) => [
      ...prev,
      ...files.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      })),
    ])
    e.target.value = '' // allow re-selecting the same file
  }

  const removeMsgAttachment = (id: string) => {
    setMsgAttachments((prev) => {
      const item = prev.find((a) => a.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  const startChat = async () => {
    const text = input.trim()
    if (!text && msgAttachments.length === 0) return
    // Convert attachments before navigating away (this component unmounts on send).
    let payload: MessageAttachment[] | undefined
    if (msgAttachments.length > 0) {
      const urls = await Promise.all(msgAttachments.map((a) => fileToDataUrl(a.file)))
      payload = msgAttachments.map((a, i) => ({
        name: a.file.name,
        type: a.file.type,
        dataUrl: urls[i],
      }))
      msgAttachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
    }
    setPendingProjectId(project.id)
    setMsgAttachments([])
    setInput('')
    setActiveView('main')
    void send(text, payload)
  }

  const openChat = (s: ChatSession) => {
    setSessionTitle(s.title)
    setSessionId(s.session_id)
    setActiveView('main')
  }

  const removeChat = async (s: ChatSession) => {
    await moveSessionToProject(s.session_id, null)
    setSessions((prev) => prev.filter((x) => x.session_id !== s.session_id))
    bumpProjectVersion()
    // The chat returns to Recents — refresh the sidebar list so it reappears.
    bumpSessionVersion()
    setToast(`"${s.title ?? 'Chat'}" removed from project`)
  }

  const moveChat = async (s: ChatSession, targetId: string) => {
    await moveSessionToProject(s.session_id, targetId)
    setSessions((prev) => prev.filter((x) => x.session_id !== s.session_id))
    bumpProjectVersion()
    const targetName = others.find((p) => p.id === targetId)?.name ?? 'project'
    setToast(`Moved to ${targetName}`)
  }

  const deleteChat = async (s: ChatSession) => {
    setConfirmDeleteChat(null)
    setSessions((prev) => prev.filter((x) => x.session_id !== s.session_id))
    // If this chat is the one currently open elsewhere, drop back to home.
    if (useAppStore.getState().sessionId === s.session_id) setSessionId(null)
    try {
      await deleteChatSession(s.session_id)
    } catch {
      /* ignore — list already updated optimistically */
    }
    bumpProjectVersion()
    setToast(`"${s.title ?? 'Chat'}" deleted`)
  }

  const openAddChat = async () => {
    setShowAddChat(true)
    try {
      const data = await listChatSessions(projectMode, 100, 0)
      setCandidates(data.sessions)
    } catch {
      setCandidates([])
    }
  }

  const addChat = async (s: ChatSession) => {
    await moveSessionToProject(s.session_id, project.id)
    setShowAddChat(false)
    setSessions((prev) => [s, ...prev])
    setCandidates((prev) => prev.filter((x) => x.session_id !== s.session_id))
    bumpProjectVersion()
    // The chat left Recents — refresh the sidebar list so it disappears there.
    bumpSessionVersion()
    setToast(`"${s.title ?? 'Chat'}" added to project`)
  }

  const saveInstructions = async () => {
    const updated = await updateProject(project.id, { instructions: instrDraft })
    setProject(updated)
    setEditingInstr(false)
    bumpProjectVersion()
  }

  const onUploadFile = async (file: File) => {
    try {
      await uploadProjectFile(project.id, file)
      const f = await listProjectFiles(project.id)
      setFiles(f.files)
      setToast(`"${file.name}" added`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const removeFile = async (f: ProjectFile) => {
    await deleteProjectFile(project.id, f.path)
    setFiles((prev) => prev.filter((x) => x.path !== f.path))
    setToast(`"${f.name}" removed`)
  }

  const addFolder = async () => {
    const path = window.prompt('Folder path on your computer:')
    if (!path || !path.trim()) return
    const name = path.trim().split('/').filter(Boolean).pop() ?? path.trim()
    const folders: ProjectFolder[] = [...project.folders, { path: path.trim(), name }]
    const updated = await updateProject(project.id, { folders })
    setProject(updated)
  }

  const removeFolder = async (folder: ProjectFolder) => {
    const folders = project.folders.filter((f) => f.path !== folder.path)
    const updated = await updateProject(project.id, { folders })
    setProject(updated)
  }

  const openRename = () => {
    setMoreMenu(null)
    setRenameDraft(project.name)
    setRenaming(true)
  }

  const saveRename = async () => {
    const name = renameDraft.trim()
    if (!name) return
    const updated = await updateProject(project.id, { name })
    setProject(updated)
    setRenaming(false)
    bumpProjectVersion()
  }

  const removeProject = async () => {
    setMoreMenu(null)
    if (!window.confirm(`Delete "${project.name}"? Its chats return to Recents.`)) return
    await deleteProject(project.id)
    bumpProjectVersion()
    goBack()
  }

  return (
    <div className="p-app">
      <div className="p-main">
        <div className="p-view">
          <div className="p-detail">
            <div className="p-detail-main">
              {/* Header */}
              <div className="p-detail-header">
                <button className="p-back-btn" onClick={goBack} title="Back to projects">
                  <IconArrowLeft />
                </button>
                <h1 className="p-detail-name">{project.name}</h1>
                <div className="p-detail-actions">
                  <button
                    className={`p-icon-btn ${isPinned ? 'is-active' : ''}`}
                    title={isPinned ? 'Remove from favorites' : 'Add to favorites'}
                    onClick={() => (isPinned ? unpinProject(project.id) : pinProject(project.id))}
                  >
                    <IconPin />
                  </button>
                  <button
                    className="p-icon-btn"
                    title="More options"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setMoreMenu({ x: r.right, y: r.bottom + 4 })
                    }}
                  >
                    <IconDots />
                  </button>
                </div>
              </div>

              {/* Composer */}
              <div>
                <input
                  ref={msgFileRef}
                  type="file"
                  multiple
                  accept={ATTACH_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={onMsgFileSelect}
                />
                <div className="p-composer">
                  {msgAttachments.length > 0 && (
                    <div className="p-attach-chips">
                      {msgAttachments.map((a) => (
                        <span key={a.id} className="p-attach-chip">
                          {a.previewUrl ? (
                            <img src={a.previewUrl} alt={a.file.name} className="p-attach-thumb" />
                          ) : (
                            <ImageIcon size={12} style={{ color: 'var(--lv-mute)' }} />
                          )}
                          <span className="p-attach-name">{a.file.name}</span>
                          <button
                            className="p-attach-x"
                            title="Remove"
                            onClick={() => removeMsgAttachment(a.id)}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <textarea
                    className="p-composer-input"
                    placeholder="What would you like to work on in this project?"
                    rows={2}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        startChat()
                      }
                    }}
                  />
                  <div className="p-composer-bottom">
                    <div className="p-composer-left">
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <button className="p-composer-add-btn" title="Attach" type="button">
                            <IconPlus />
                          </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            sideOffset={8}
                            align="start"
                            className="p-attach-menu"
                          >
                            <DropdownMenu.Item
                              className="p-attach-menu-item"
                              onSelect={() => msgFileRef.current?.click()}
                            >
                              <ImageIcon size={14} style={{ color: 'var(--lv-mute)' }} />
                              Add files or photos
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                    <button
                      className="p-composer-send"
                      title="Send"
                      onClick={startChat}
                      disabled={!input.trim() && msgAttachments.length === 0}
                    >
                      <IconSend />
                    </button>
                  </div>
                </div>
                <div className="p-composer-toolbar">
                  <div className="p-toolbar-right">
                    <ModelEffortSelector />
                  </div>
                </div>
              </div>

              {/* Chats */}
              <div className="p-section-label">
                Recents
                <span className="p-section-label-line" />
              </div>

              {sessions.length > 0 ? (
                <div className="p-chat-list">
                  {sessions.map((s) => (
                    <ChatItem
                      key={s.session_id}
                      session={s}
                      onOpen={() => openChat(s)}
                      onMore={(e, sess) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setChatMenu({ x: r.right, y: r.bottom + 4, session: sess })
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-empty">
                  <div className="p-empty-title">No chats yet</div>
                  <div className="p-empty-desc">
                    Start a conversation above or add existing chats to this project.
                  </div>
                  <button className="p-btn p-btn--ghost p-btn--sm" onClick={openAddChat}>
                    Add existing chat <span className="p-arrow">→</span>
                  </button>
                </div>
              )}

              {sessions.length > 0 && (
                <div style={{ marginTop: '1.2rem', textAlign: 'center' }}>
                  <button className="p-btn p-btn--ghost p-btn--sm" onClick={openAddChat}>
                    Add existing chat <span className="p-arrow">→</span>
                  </button>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="p-detail-sidebar">
              <SidebarPanel
                title="Instructions"
                onEdit={() => {
                  setInstrDraft(project.instructions ?? '')
                  setEditingInstr(true)
                }}
              >
                {editingInstr ? (
                  <div>
                    <textarea
                      className="p-panel-edit"
                      rows={5}
                      value={instrDraft}
                      onChange={(e) => setInstrDraft(e.target.value)}
                      autoFocus
                    />
                    <div className="p-modal-actions" style={{ marginTop: '0.6rem' }}>
                      <button
                        className="p-btn p-btn--ghost p-btn--sm"
                        onClick={() => setEditingInstr(false)}
                      >
                        Cancel
                      </button>
                      <button className="p-btn p-btn--sm" onClick={saveInstructions}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : project.instructions ? (
                  <p style={{ margin: 0 }}>{project.instructions}</p>
                ) : (
                  <p className="p-panel-empty">Add instructions for this project.</p>
                )}
              </SidebarPanel>

              <SidebarPanel title="Scheduled" onAdd={() => setToast('Scheduling coming soon')}>
                <p className="p-panel-empty">Set up recurring tasks for this project.</p>
              </SidebarPanel>

              <SidebarPanel title="Context">
                <>
                  <div className="p-ctx-group" style={{ marginTop: 0 }}>
                    Files
                    <button
                      className="p-ctx-remove"
                      style={{ opacity: 1, marginLeft: 8, color: 'var(--lv-mute)' }}
                      title="Upload file"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      +
                    </button>
                  </div>
                  {files.length > 0 ? (
                    files.map((f) => (
                      <div key={f.path} className="p-ctx-item">
                        <span className="p-ctx-arrow">▸</span>
                        <span className="p-ctx-icon">
                          <IconChat />
                        </span>
                        <span>{f.name}</span>
                        <button
                          className="p-ctx-remove"
                          title="Remove file"
                          onClick={() => removeFile(f)}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="p-panel-empty">No files uploaded.</p>
                  )}

                  <div className="p-ctx-group">
                    On your computer
                    <button
                      className="p-ctx-remove"
                      style={{ opacity: 1, marginLeft: 8, color: 'var(--lv-mute)' }}
                      title="Add folder"
                      onClick={addFolder}
                    >
                      +
                    </button>
                  </div>
                  {project.folders.length > 0 ? (
                    project.folders.map((c) => (
                      <div key={c.path} className="p-ctx-item">
                        <span className="p-ctx-arrow">▸</span>
                        <span className="p-ctx-icon">
                          <IconFolder />
                        </span>
                        <span>{c.name}</span>
                        <button
                          className="p-ctx-remove"
                          title="Remove folder"
                          onClick={() => removeFolder(c)}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="p-panel-empty">No folders linked.</p>
                  )}

                  <div className="p-ctx-group">Memory</div>
                  <div className="p-ctx-item">
                    <span className="p-ctx-arrow">▸</span>
                    <span className="p-ctx-icon">
                      <IconMemory />
                    </span>
                    <span>Project memory</span>
                  </div>
                </>
              </SidebarPanel>
            </div>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUploadFile(f)
          e.target.value = ''
        }}
      />

      {/* Chat row context menu */}
      {chatMenu && (
        <ContextMenu x={chatMenu.x} y={chatMenu.y} onClose={() => setChatMenu(null)}>
          {others.length > 0 && (
            <>
              <div className="p-context-sub">Move to</div>
              {others.map((p) => (
                <button
                  key={p.id}
                  className="p-context-item"
                  onClick={() => {
                    moveChat(chatMenu.session, p.id)
                    setChatMenu(null)
                  }}
                >
                  <IconFolder /> {p.name}
                </button>
              ))}
              <div className="p-context-sep" />
            </>
          )}
          <button
            className="p-context-item"
            onClick={() => {
              removeChat(chatMenu.session)
              setChatMenu(null)
            }}
          >
            <IconMove /> Remove from project
          </button>
          <button
            className="p-context-item p-context-item--danger"
            onClick={() => {
              setConfirmDeleteChat(chatMenu.session)
              setChatMenu(null)
            }}
          >
            <IconTrash /> Delete chat
          </button>
        </ContextMenu>
      )}

      {/* Project more menu */}
      {moreMenu && (
        <ContextMenu x={moreMenu.x} y={moreMenu.y} onClose={() => setMoreMenu(null)}>
          <button className="p-context-item" onClick={openRename}>
            Rename project
          </button>
          <div className="p-context-sep" />
          <button className="p-context-item p-context-item--danger" onClick={removeProject}>
            <IconTrash /> Delete project
          </button>
        </ContextMenu>
      )}

      {/* Rename project dialog */}
      {renaming && (
        <Modal onClose={() => setRenaming(false)}>
          <div className="p-modal-title">Rename Project</div>
          <div className="p-modal-desc">Choose a new name for this project.</div>
          <input
            className="p-modal-input"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename()
            }}
            autoFocus
          />
          <div className="p-modal-actions">
            <button className="p-btn p-btn--ghost p-btn--sm" onClick={() => setRenaming(false)}>
              Cancel
            </button>
            <button className="p-btn p-btn--sm" onClick={saveRename} disabled={!renameDraft.trim()}>
              Save
            </button>
          </div>
        </Modal>
      )}

      {/* Delete chat confirmation dialog */}
      {confirmDeleteChat && (
        <Modal onClose={() => setConfirmDeleteChat(null)}>
          <div className="p-modal-title">Delete Chat</div>
          <div className="p-modal-desc">
            Permanently delete “{confirmDeleteChat.title ?? 'Untitled chat'}” and all its messages?
            This cannot be undone.
          </div>
          <div className="p-modal-actions">
            <button
              className="p-btn p-btn--ghost p-btn--sm"
              onClick={() => setConfirmDeleteChat(null)}
            >
              Cancel
            </button>
            <button
              className="p-btn p-btn--sm"
              style={{ background: '#e85a5a', borderColor: '#e85a5a' }}
              onClick={() => deleteChat(confirmDeleteChat)}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}

      {/* Add existing chat modal */}
      {showAddChat && (
        <Modal onClose={() => setShowAddChat(false)}>
          <div className="p-modal-title">Add Existing Chat</div>
          <div className="p-modal-desc">Choose a chat to add to “{project.name}”.</div>
          {candidates.length > 0 ? (
            <div className="p-add-chat-list">
              {candidates.map((c) => (
                <button key={c.session_id} className="p-add-chat-row" onClick={() => addChat(c)}>
                  <div className="p-chat-icon" style={{ width: 32, height: 32 }}>
                    <IconChat />
                  </div>
                  <div className="p-add-chat-row-info">
                    <div className="p-add-chat-row-title">{c.title ?? 'Untitled chat'}</div>
                    <div className="p-add-chat-row-preview">{relTime(c.updated_at)}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-search-empty">All chats are assigned to projects</div>
          )}
        </Modal>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
