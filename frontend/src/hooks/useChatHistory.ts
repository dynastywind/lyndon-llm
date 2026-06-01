import { useCallback, useEffect, useRef, useState } from 'react'
import { listChatSessions } from '@/api/client'
import { useAppStore } from '@/store'
import type { ChatSession } from '@/types'

const INITIAL_LIMIT = 20
const MORE_LIMIT = 5

export function useChatHistory(mode = 'chat') {
  const sessionListVersion = useAppStore((s) => s.sessionListVersion)
  // Re-fetch when the logged-in user changes (login / logout)
  const userId = useAppStore((s) => s.user?.id ?? null)

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const hasMore = sessions.length < total

  // ── Initial / refresh fetch ────────────────────────────────────────────────

  const fetchInitial = useCallback(async () => {
    // No user logged in — clear the list immediately, don't fetch
    if (!userId) {
      setSessions([])
      setTotal(0)
      return
    }
    setLoading(true)
    try {
      const data = await listChatSessions(mode, INITIAL_LIMIT, 0)
      setSessions(data.sessions)
      setTotal(data.total)
    } catch {
      // silently ignore when backend is down
    } finally {
      setLoading(false)
    }
  }, [mode, userId])

  // Re-fetch whenever the session list is bumped (after a message completes
  // or a new session is created).
  useEffect(() => {
    fetchInitial()
  }, [fetchInitial, sessionListVersion, userId])

  // ── Load more (called by IntersectionObserver in Sidebar) ─────────────────

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const data = await listChatSessions(mode, MORE_LIMIT, sessions.length)
      setSessions((prev) => {
        // Deduplicate in case the list shifted between fetches
        const existingIds = new Set(prev.map((s) => s.session_id))
        const fresh = data.sessions.filter((s) => !existingIds.has(s.session_id))
        return [...prev, ...fresh]
      })
      setTotal(data.total)
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, sessions.length, mode])

  // ── Sentinel ref for IntersectionObserver ────────────────────────────────

  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore()
      },
      { threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  // Optimistically remove one session from local state without a round-trip.
  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId))
    setTotal((prev) => Math.max(0, prev - 1))
  }, [])

  return {
    sessions,
    loading,
    loadingMore,
    hasMore,
    sentinelRef,
    refresh: fetchInitial,
    removeSession,
  }
}
