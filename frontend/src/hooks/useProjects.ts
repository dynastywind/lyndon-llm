import { useCallback, useEffect, useState } from 'react'
import { listProjects } from '@/api/client'
import { useAppStore } from '@/store'
import type { Project } from '@/types'

/** Fetch the current user's projects for a mode, refreshing on projectListVersion. */
export function useProjects(mode = 'chat') {
  const projectListVersion = useAppStore((s) => s.projectListVersion)
  const userId = useAppStore((s) => s.user?.id ?? null)

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) {
      setProjects([])
      return
    }
    setLoading(true)
    try {
      const data = await listProjects(mode)
      setProjects(data.projects)
    } catch {
      // backend down — leave list as-is
    } finally {
      setLoading(false)
    }
  }, [mode, userId])

  useEffect(() => {
    refresh()
  }, [refresh, projectListVersion])

  return { projects, loading, refresh }
}
