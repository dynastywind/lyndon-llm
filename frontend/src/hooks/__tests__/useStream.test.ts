/**
 * useStream hook — behavioural tests.
 *
 * The hook ties together session creation, store mutations, and the
 * streamChat API call. All external dependencies are mocked so no real
 * network or backend is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStream } from '../useStream'
import { useAppStore } from '@/store'

// ── mock @/api/client ─────────────────────────────────────────────────────────

vi.mock('@/api/client', () => ({
  createChatSession: vi.fn(),
  streamChat: vi.fn(),
}))

import { createChatSession, streamChat } from '@/api/client'

// ── helpers ───────────────────────────────────────────────────────────────────

type OnEventFn = (type: string, data: Record<string, unknown>) => void

/** Make streamChat call onEvent with the provided frames, then resolve. */
function stubStreamChat(frames: Array<[string, Record<string, unknown>]>) {
  vi.mocked(streamChat).mockImplementation((_msg, _sid, onEvent: OnEventFn) => {
    for (const [type, data] of frames) {
      onEvent(type, data)
    }
    return Promise.resolve()
  })
}

function resetStore() {
  useAppStore.setState({
    sessionId: 'existing-session',
    sessionMessages: {},
    streamingSet: {},
    isStreaming: false,
    systemPrompt: '',
    sessionPrompts: {},
    appliedSessionPrompts: {},
    selectedModel: null,
    chatPendingPlan: null,
    chatPlanStatus: 'idle',
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useStream — token events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('token events accumulate in assistant message content', async () => {
    stubStreamChat([
      ['token', { text: 'Hello' }],
      ['token', { text: ', world' }],
      ['token', { text: '!' }],
    ])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('hi')
    })

    const sid = 'existing-session'
    const msgs = useAppStore.getState().sessionMessages[sid] ?? []
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.content).toBe('Hello, world!')
  })

  it('user message bubble is added before streaming starts', async () => {
    stubStreamChat([])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('my question')
    })

    const sid = 'existing-session'
    const msgs = useAppStore.getState().sessionMessages[sid] ?? []
    const user = msgs.find((m) => m.role === 'user')
    expect(user?.content).toBe('my question')
  })
})

describe('useStream — thinking_token events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('thinking_token events accumulate in the thinking field', async () => {
    stubStreamChat([
      ['thinking_token', { text: 'step 1 ' }],
      ['thinking_token', { text: 'step 2' }],
      ['token', { text: 'answer' }],
    ])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('think about this')
    })

    const sid = 'existing-session'
    const msgs = useAppStore.getState().sessionMessages[sid] ?? []
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.thinking).toBe('step 1 step 2')
    expect(assistant?.content).toBe('answer')
  })

  it('thinking field is absent when no thinking_token events arrive', async () => {
    stubStreamChat([['token', { text: 'direct answer' }]])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('no thinking')
    })

    const sid = 'existing-session'
    const msgs = useAppStore.getState().sessionMessages[sid] ?? []
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.thinking ?? undefined).toBeUndefined()
  })
})

describe('useStream — tool call events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('tool_start adds a running ToolCallRecord', async () => {
    stubStreamChat([['tool_start', { id: 'tc1', name: 'web_search', args: { query: 'cats' } }]])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('search for cats')
    })

    const msgs = useAppStore.getState().sessionMessages['existing-session'] ?? []
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.toolCalls).toHaveLength(1)
    expect(assistant?.toolCalls?.[0]).toMatchObject({
      id: 'tc1',
      name: 'web_search',
      status: 'running',
    })
  })

  it('tool_result marks the matching tool call done', async () => {
    stubStreamChat([
      ['tool_start', { id: 'tc1', name: 'web_search', args: {} }],
      ['tool_result', { id: 'tc1', success: true, preview: '3 results' }],
    ])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('search')
    })

    const msgs = useAppStore.getState().sessionMessages['existing-session'] ?? []
    const assistant = msgs.find((m) => m.role === 'assistant')
    const tc = assistant?.toolCalls?.[0]
    expect(tc?.status).toBe('done')
    expect(tc?.preview).toBe('3 results')
  })

  it('tool_result marks failed tool call as error', async () => {
    stubStreamChat([
      ['tool_start', { id: 'tc1', name: 'broken_tool', args: {} }],
      ['tool_result', { id: 'tc1', success: false, preview: 'timeout' }],
    ])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('run')
    })

    const msgs = useAppStore.getState().sessionMessages['existing-session'] ?? []
    const tc = msgs.find((m) => m.role === 'assistant')?.toolCalls?.[0]
    expect(tc?.status).toBe('error')
  })
})

describe('useStream — streaming lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('stopStreaming is called even when streamChat rejects', async () => {
    vi.mocked(streamChat).mockRejectedValue(new Error('network failure'))

    const { result } = renderHook(() => useStream())
    await act(async () => {
      try {
        await result.current.send('hello')
      } catch {
        // streamChat rejection propagates out of send() — this is expected
      }
    })

    // After the rejected promise settles, the session must not be stuck streaming
    const sid = 'existing-session'
    expect(useAppStore.getState().streamingSet[sid]).toBeUndefined()
    expect(useAppStore.getState().isStreaming).toBe(false)
  })

  it('isStreaming is false after a successful stream completes', async () => {
    stubStreamChat([['token', { text: 'done' }]])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('go')
    })

    expect(useAppStore.getState().isStreaming).toBe(false)
  })
})

describe('useStream — lazy session creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Start with no sessionId to trigger session creation
    useAppStore.setState({
      sessionId: null,
      sessionMessages: {},
      streamingSet: {},
      isStreaming: false,
      systemPrompt: '',
      sessionPrompts: {},
      appliedSessionPrompts: {},
      selectedModel: null,
      chatPendingPlan: null,
      chatPlanStatus: 'idle',
    })
  })

  it('creates a new session before streaming when sessionId is null', async () => {
    vi.mocked(createChatSession).mockResolvedValue({
      session_id: 'new-session',
      mode: 'chat',
      created_at: new Date().toISOString(),
    })
    stubStreamChat([['token', { text: 'hi' }]])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('first message')
    })

    expect(createChatSession).toHaveBeenCalledOnce()
    expect(useAppStore.getState().sessionId).toBe('new-session')
  })

  it('does not call createChatSession when sessionId is already set', async () => {
    useAppStore.setState({ sessionId: 'preset-session' })
    stubStreamChat([])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('message')
    })

    expect(createChatSession).not.toHaveBeenCalled()
  })

  it('aborts silently when createChatSession throws', async () => {
    vi.mocked(createChatSession).mockRejectedValue(new Error('server down'))

    const { result } = renderHook(() => useStream())
    // Should not throw
    await act(async () => {
      await result.current.send('oops')
    })

    expect(streamChat).not.toHaveBeenCalled()
  })
})

// ── plan_preview event ────────────────────────────────────────────────────────

describe('useStream — plan_preview event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('stores the plan and sets chatPlanStatus to pending_confirm', async () => {
    const fakePlan = { plan_id: 'p1', steps: [{ step_id: 's1', description: 'do it' }] }
    stubStreamChat([['plan_preview', fakePlan as Record<string, unknown>]])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('plan something')
    })

    expect(useAppStore.getState().chatPendingPlan).toMatchObject({ plan_id: 'p1' })
    expect(useAppStore.getState().chatPlanStatus).toBe('pending_confirm')
  })

  it('removes the empty assistant bubble when plan_preview arrives', async () => {
    const fakePlan = { plan_id: 'p1', steps: [] }
    stubStreamChat([['plan_preview', fakePlan as Record<string, unknown>]])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('plan')
    })

    // The hook creates a placeholder assistant bubble then removes it on plan_preview
    const msgs = useAppStore.getState().sessionMessages['existing-session'] ?? []
    const assistants = msgs.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(0)
  })
})

// ── chart event ───────────────────────────────────────────────────────────────

describe('useStream — chart event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('appends chart markdown block to assistant content', async () => {
    const spec = { type: 'bar', title: 'Revenue', x_key: 'q', data: [] }
    stubStreamChat([['chart', { spec }]])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('show chart')
    })

    const msgs = useAppStore.getState().sessionMessages['existing-session'] ?? []
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.content).toContain('```chart')
    expect(assistant?.content).toContain('"title"')
  })
})

// ── error and metrics events ──────────────────────────────────────────────────

describe('useStream — error and metrics events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('error event does not crash — store remains consistent', async () => {
    stubStreamChat([['error', { message: 'backend exploded' }]])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('go')
    })

    // Streaming should be cleaned up even after an error event
    expect(useAppStore.getState().isStreaming).toBe(false)
  })

  it('metrics event does not affect store state', async () => {
    stubStreamChat([
      ['metrics', { total_ms: 1234, phases: { ttft: 100, stream: 1134 } }],
      ['token', { text: 'done' }],
    ])

    const { result } = renderHook(() => useStream())
    await act(async () => {
      await result.current.send('go')
    })

    // Only the token should appear in content — metrics has no store effect
    const msgs = useAppStore.getState().sessionMessages['existing-session'] ?? []
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.content).toBe('done')
  })
})
