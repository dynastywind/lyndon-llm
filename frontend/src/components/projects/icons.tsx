// Inline SVG icons for the Projects surface — ported from the design handoff
// (projects-ui.jsx). No icon library, per the brand rule.

export function IconSearch() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  )
}

export function IconSort() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="4" y1="6" x2="13" y2="6" />
      <line x1="4" y1="12" x2="17" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}

export function IconPin() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconPlus() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function IconFolder() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 7 L3 19 L21 19 L21 9 L12 9 L10 7 Z" />
    </svg>
  )
}

export function IconChat() {
  // Chat callout — rounded speech bubble with a tail.
  return (
    <svg viewBox="0 0 24 24">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function IconArrowLeft() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

export function IconEdit() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M17 3l4 4L7 21H3v-4L17 3z" />
    </svg>
  )
}

export function IconMove() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="15 3 21 3 21 9" />
      <line x1="21" y1="3" x2="13" y2="11" />
      <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

export function IconTrash() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

export function IconMemory() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  )
}

export function IconDots() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconSend() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

export function IconPushpin() {
  // Classic pushpin (distinct from the favorite star).
  return (
    <svg viewBox="0 0 24 24">
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z" />
      <line x1="12" y1="16" x2="12" y2="21" />
    </svg>
  )
}

export function IconFile() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M14 3 H6 a1 1 0 0 0 -1 1 v16 a1 1 0 0 0 1 1 h12 a1 1 0 0 0 1 -1 V8 z" />
      <polyline points="14 3 14 8 19 8" />
    </svg>
  )
}

export function IconArchive() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  )
}
