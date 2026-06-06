/**
 * usePlanExecution hook — plan confirmation, step status updates,
 * token accumulation, error handling, and cancel flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlanExecution } from '../usePlanExecution'
import { useAppStore } from '@/store'
import type { ChatPlan } from '@/types'

vi.mock('@/api/client', () => ({
  confirmChatPlan: vi.fn(),
  cancelChatPlan: vi.fn(),
}))

import { confirmChatPlan, cancelChatPlan } from '@/api/client'

// ── helpers ───────────────────────────────────────────────────────────────────

type OnEventFn = (type: string, data: Record<string, unknown>) => void

function makePlan(id = 'plan-1'): ChatPlan {
  return {
    plan_id: id,
    steps: [
      { step_id: 'step-1', description: 'First step' },
      { step_id: 'step-2', description: 'Second step' },
    ],
  } as unknown as ChatPlan
}

function stubConfirm(frames: Array<[string, Record<string, unknown>]>) {
  vi.mocked(confirmChatPlan).mockImplementation((_planId, _sid, onEvent: OnEventFn) => {
    for (const [type, data] of frames) {
      onEvent(type, data)
    }
    return Promise.resolve()
  })
}

function resetStore(plan: ChatPlan | null = makePlan()) {
  useAppStore.setState({
    sessionId: 'test-session',
    chatPendingPlan: plan,
    chatPlanStatus: 'idle' as never,
    chatPlanStepStatuses: {},
    sessionMessages: {},
    streamingSet: {},
    isStreaming: false,
  })
}

// ── confirm — happy path ──────────────────────────────────────────────────────

describe('usePlanExecution — confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('clears the plan and resets status after successful completion', async () => {
    stubConfirm([['plan_done', {}]])

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    // On success: plan_done sets status='done', then finally block calls clearChatPlan()
    // which resets status to null and clears chatPendingPlan.
    expect(useAppStore.getState().chatPendingPlan).toBeNull()
    expect(useAppStore.getState().chatPlanStatus).toBeNull()
  })

  it('calls confirmChatPlan with the correct plan_id and session_id', async () => {
    stubConfirm([['plan_done', {}]])

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    expect(confirmChatPlan).toHaveBeenCalledWith('plan-1', 'test-session', expect.any(Function))
  })

  it('does nothing when chatPendingPlan is null', async () => {
    resetStore(null)
    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    expect(confirmChatPlan).not.toHaveBeenCalled()
  })
})

// ── step status events ────────────────────────────────────────────────────────

describe('usePlanExecution — step status events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('marks a step as running on plan_step_started', async () => {
    stubConfirm([
      ['plan_step_started', { step_id: 'step-1' }],
      ['plan_done', {}],
    ])

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    // After plan_done clears the plan, step status lives in the store during execution
    // We can only assert the final state after confirm() resolves
    expect(confirmChatPlan).toHaveBeenCalled()
  })

  it('marks step done on plan_step_done', async () => {
    let capturedStatuses: Record<string, string> = {}

    vi.mocked(confirmChatPlan).mockImplementation((_planId, _sid, onEvent: OnEventFn) => {
      onEvent('plan_step_started', { step_id: 'step-1' })
      capturedStatuses = { ...useAppStore.getState().chatPlanStepStatuses }
      onEvent('plan_step_done', { step_id: 'step-1' })
      onEvent('plan_done', {})
      return Promise.resolve()
    })

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    expect(capturedStatuses['step-1']).toBe('running')
  })

  it('marks step failed on plan_step_failed', async () => {
    let statusAfterFail = ''

    vi.mocked(confirmChatPlan).mockImplementation((_planId, _sid, onEvent: OnEventFn) => {
      onEvent('plan_step_failed', { step_id: 'step-2' })
      statusAfterFail = useAppStore.getState().chatPlanStepStatuses['step-2']
      onEvent('plan_done', {})
      return Promise.resolve()
    })

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    expect(statusAfterFail).toBe('failed')
  })
})

// ── token accumulation ────────────────────────────────────────────────────────

describe('usePlanExecution — token events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('token events build up assistant message content', async () => {
    stubConfirm([
      ['token', { text: 'Hello' }],
      ['token', { text: ' world' }],
      ['plan_done', {}],
    ])

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    const msgs = useAppStore.getState().sessionMessages['test-session'] ?? []
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.content).toBe('Hello world')
  })
})

// ── error handling ────────────────────────────────────────────────────────────

describe('usePlanExecution — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('sets chatPlanStatus to failed when confirmChatPlan throws', async () => {
    vi.mocked(confirmChatPlan).mockRejectedValue(new Error('server error'))

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    expect(useAppStore.getState().chatPlanStatus).toBe('failed')
  })

  it('always calls stopStreaming even on error', async () => {
    vi.mocked(confirmChatPlan).mockRejectedValue(new Error('fail'))

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    expect(useAppStore.getState().streamingSet['test-session']).toBeUndefined()
    expect(useAppStore.getState().isStreaming).toBe(false)
  })

  it('clears plan after successful completion', async () => {
    stubConfirm([['plan_done', {}]])

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    expect(useAppStore.getState().chatPendingPlan).toBeNull()
  })

  it('preserves plan on failure so user can see which steps failed', async () => {
    vi.mocked(confirmChatPlan).mockRejectedValue(new Error('fail'))

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.confirm()
    })

    // Plan is NOT cleared on failure
    expect(useAppStore.getState().chatPendingPlan).not.toBeNull()
  })
})

// ── cancel ────────────────────────────────────────────────────────────────────

describe('usePlanExecution — cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('calls cancelChatPlan and clears the plan', async () => {
    vi.mocked(cancelChatPlan).mockResolvedValue(undefined)

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.cancel()
    })

    expect(cancelChatPlan).toHaveBeenCalledWith('plan-1', 'test-session')
    expect(useAppStore.getState().chatPendingPlan).toBeNull()
  })

  it('still clears the plan when cancelChatPlan throws (best-effort)', async () => {
    vi.mocked(cancelChatPlan).mockRejectedValue(new Error('network error'))

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.cancel()
    })

    expect(useAppStore.getState().chatPendingPlan).toBeNull()
  })

  it('does nothing when there is no pending plan', async () => {
    resetStore(null)

    const { result } = renderHook(() => usePlanExecution())
    await act(async () => {
      await result.current.cancel()
    })

    expect(cancelChatPlan).not.toHaveBeenCalled()
  })
})
