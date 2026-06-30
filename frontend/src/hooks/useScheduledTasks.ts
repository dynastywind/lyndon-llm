import { useCallback, useEffect, useState } from 'react'
import { listScheduledTasks } from '@/api/client'
import { useAppStore } from '@/store'
import type { ScheduledTask } from '@/types'

/**
 * Loads the current user's scheduled tasks, with optimistic local mutation
 * helpers. Mirrors `useChatHistory` (fetch on mount / user change).
 */
export function useScheduledTasks() {
  const userId = useAppStore((s) => s.user?.id ?? null)
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) {
      setTasks([])
      return
    }
    setLoading(true)
    try {
      const data = await listScheduledTasks()
      setTasks(data.tasks)
    } catch {
      /* backend down — leave the list as-is */
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const upsertTask = useCallback((task: ScheduledTask) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id)
      if (idx === -1) return [task, ...prev]
      const next = [...prev]
      next[idx] = task
      return next
    })
  }, [])

  const removeTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }, [])

  return { tasks, loading, refresh, upsertTask, removeTask }
}
