// Shared building blocks for the Projects surface: ContextMenu, Modal, Toast,
// SidebarPanel.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconPlus } from './icons'

export interface MenuPos {
  x: number
  y: number
}

/** Fixed-position popover that flips to stay inside the viewport. */
export function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      let left = x
      let top = y
      if (x + rect.width > window.innerWidth - 8) left = x - rect.width
      if (y + rect.height > window.innerHeight - 8) top = y - rect.height
      setPos({ left: Math.max(8, left), top: Math.max(8, top) })
    }
  }, [x, y])

  return (
    <>
      <div className="p-context-menu-overlay" onClick={onClose} />
      <div className="p-context-menu" ref={menuRef} style={{ left: pos.left, top: pos.top }}>
        {children}
      </div>
    </>
  )
}

/** Centered modal; closes on Escape or backdrop click. */
export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="p-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="p-modal">{children}</div>
    </div>
  )
}

/** Bottom-center pill toast that auto-dismisses. */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400)
    return () => clearTimeout(t)
  }, [onDone])
  return <div className="p-toast">{message}</div>
}

/** Collapsible sidebar panel with optional edit/add header actions. */
export function SidebarPanel({
  title,
  children,
  defaultOpen = true,
  onEdit,
  onAdd,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  onEdit?: () => void
  onAdd?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="p-panel">
      <div className="p-panel-header" onClick={() => setOpen((o) => !o)}>
        <span className="p-panel-title">{title}</span>
        <div className="p-panel-actions">
          {onEdit && (
            <button
              className="p-panel-icon"
              title="Edit"
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
            >
              {/* pencil */}
              <svg viewBox="0 0 24 24">
                <path d="M17 3l4 4L7 21H3v-4L17 3z" />
              </svg>
            </button>
          )}
          {onAdd && (
            <button
              className="p-panel-icon"
              title="Add"
              onClick={(e) => {
                e.stopPropagation()
                onAdd()
              }}
            >
              <IconPlus />
            </button>
          )}
          <span className={`p-panel-chevron ${open ? 'open' : ''}`}>▾</span>
        </div>
      </div>
      {open && <div className="p-panel-content">{children}</div>}
    </div>
  )
}
