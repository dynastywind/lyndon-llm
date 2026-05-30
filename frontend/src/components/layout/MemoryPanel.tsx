import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { getMemories, deleteMemory } from '@/api/client'
import type { MemoryRecord, MemoryType } from '@/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

const TYPE_LABEL: Record<MemoryType, string> = {
  episodic: 'episodic',
  semantic: 'semantic',
  procedural: 'procedural',
}

const TYPE_COLOR: Record<MemoryType, string> = {
  episodic: 'var(--lv-gold)',
  semantic: 'var(--lv-soft)',
  procedural: 'var(--lv-mute)',
}

// ── MemoryRow ─────────────────────────────────────────────────────────────────

function MemoryRow({ record, onDelete }: { record: MemoryRecord; onDelete: (id: string) => void }) {
  const [hov, setHov] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleting(true)
    try {
      await deleteMemory(record.id)
      onDelete(record.id)
    } catch {
      setDeleting(false)
    }
  }

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '10px 12px',
        border: `1px solid ${hov ? 'var(--lv-rule-strong)' : 'var(--lv-rule)'}`,
        background: hov ? 'rgba(255,255,255,0.02)' : 'transparent',
        transition: 'border-color 0.15s, background 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Top row: type badge + time + delete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 8.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: TYPE_COLOR[record.memory_type] ?? 'var(--lv-mute)',
            border: `1px solid ${TYPE_COLOR[record.memory_type] ?? 'var(--lv-rule)'}`,
            padding: '1px 5px',
            flexShrink: 0,
            opacity: 0.85,
          }}
        >
          {TYPE_LABEL[record.memory_type] ?? record.memory_type}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9.5,
            color: 'var(--lv-mute)',
            flex: 1,
          }}
        >
          {relativeTime(record.created_at)}
        </span>
        {/* Importance bar */}
        <div
          style={{
            width: 28,
            height: 2,
            background: 'var(--lv-rule)',
            borderRadius: 0,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: `${Math.round(record.importance * 100)}%`,
              height: '100%',
              background: 'var(--lv-gold)',
              opacity: 0.6,
            }}
          />
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{
            background: 'none',
            border: 'none',
            cursor: deleting ? 'not-allowed' : 'pointer',
            padding: 2,
            lineHeight: 0,
            flexShrink: 0,
            color: hov ? 'var(--lv-mute)' : 'transparent',
            transition: 'color 0.15s',
          }}
          className="hover:!text-red-400"
          title="Delete memory"
        >
          {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
        </button>
      </div>

      {/* Content */}
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 12.5,
          color: 'var(--lv-soft)',
          lineHeight: 1.55,
          margin: 0,
        }}
      >
        {record.content}
      </p>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function MemoryPanel({ active = true }: { active?: boolean }) {
  const [records, setRecords] = useState<MemoryRecord[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getMemories()
      setRecords(res.memories)
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active) load()
  }, [active, load])

  const handleDelete = useCallback((id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id))
  }, [])

  if (loading && !records.length) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '40px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--lv-mute)',
        }}
      >
        <Loader2 size={13} className="animate-spin" />
        Loading memories…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--lv-mute)',
          }}
        >
          {records.length} memor{records.length === 1 ? 'y' : 'ies'} stored
        </span>
        <button
          onClick={load}
          title="Refresh"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--lv-mute)',
            padding: 4,
            lineHeight: 0,
          }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Empty state */}
      {records.length === 0 && !loading && (
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--lv-mute)',
            textAlign: 'center',
            paddingTop: 24,
            lineHeight: 1.8,
          }}
        >
          No memories yet.
          <br />
          Memories form automatically
          <br />
          as conversations compress.
        </p>
      )}

      {/* Memory list */}
      {records.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {records.map((r) => (
            <MemoryRow key={r.id} record={r} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
