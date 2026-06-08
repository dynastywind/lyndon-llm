/**
 * useProjects hook — fetch lifecycle, no-user guard, error tolerance,
 * and refresh on projectListVersion bump.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useProjects } from '../useProjects'
import { useAppStore } from '@/store'

vi.mock('@/api/client', () => ({
  listProjects: vi.fn(),
}))

import { listProjects } from '@/api/client'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeProject(id: string, mode = 'chat') {
  return {
    id,
    mode,
    name: `Project ${id}`,
    instructions: null,
    folders: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    chat_count: 0,
  }
}

function stubList(projects: ReturnType<typeof makeProject>[]) {
  vi.mocked(listProjects).mockResolvedValue({ projects })
}

function resetStore(userId: string | null = 'user-1') {
  useAppStore.setState({
    user: userId ? { id: userId, username: 'tester', email: null, token: 'tok' } : null,
    projectListVersion: 0,
  })
}

// ── initial fetch ─────────────────────────────────────────────────────────────

describe('useProjects — initial fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('fetches projects on mount when a user is logged in', async () => {
    stubList([makeProject('p1'), makeProject('p2')])

    const { result } = renderHook(() => useProjects())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(listProjects).toHaveBeenCalledWith('chat')
    expect(result.current.projects).toHaveLength(2)
    expect(result.current.projects[0].id).toBe('p1')
  })

  it('passes the requested mode through to listProjects', async () => {
    stubList([makeProject('c1', 'code')])

    const { result } = renderHook(() => useProjects('code'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(listProjects).toHaveBeenCalledWith('code')
  })

  it('does not fetch and clears projects when no user is logged in', async () => {
    resetStore(null)
    stubList([makeProject('p1')])

    const { result } = renderHook(() => useProjects())

    await act(async () => {})

    expect(listProjects).not.toHaveBeenCalled()
    expect(result.current.projects).toHaveLength(0)
  })

  it('ignores network errors and leaves the list unchanged', async () => {
    vi.mocked(listProjects).mockRejectedValue(new Error('500'))

    const { result } = renderHook(() => useProjects())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.projects).toHaveLength(0)
  })
})

// ── refresh ─────────────────────────────────────────────────────────────────

describe('useProjects — refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('re-fetches when projectListVersion is bumped', async () => {
    stubList([makeProject('p1')])
    const { result } = renderHook(() => useProjects())
    await waitFor(() => expect(result.current.projects).toHaveLength(1))

    stubList([makeProject('p1'), makeProject('p2')])
    act(() => useAppStore.getState().bumpProjectVersion())

    await waitFor(() => expect(result.current.projects).toHaveLength(2))
    expect(listProjects).toHaveBeenCalledTimes(2)
  })

  it('exposes a manual refresh() that re-fetches', async () => {
    stubList([makeProject('p1')])
    const { result } = renderHook(() => useProjects())
    await waitFor(() => expect(result.current.projects).toHaveLength(1))

    stubList([makeProject('p1'), makeProject('p2'), makeProject('p3')])
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.projects).toHaveLength(3)
  })
})
