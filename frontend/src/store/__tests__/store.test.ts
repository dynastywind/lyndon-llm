/**
 * Zustand store — state consistency tests.
 * Each test creates a fresh store instance to avoid cross-test pollution.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Message as _Message } from '@/types'

// Re-create minimal store logic matching src/store/index.ts for isolation.
// (We import the real store but reset it between tests.)
import { useAppStore } from '../index'

function freshState() {
  // Reset the Zustand store to initial values between tests
  useAppStore.setState({
    sessionId: null,
    sessionMessages: {},
    streamingSet: {},
    isStreaming: false,
  })
}

// ── per-session message isolation ─────────────────────────────────────────────

describe('sessionMessages isolation', () => {
  beforeEach(freshState)

  it('messages added to session A do not appear in session B', () => {
    useAppStore.getState().addSessionMessage('session-A', {
      role: 'user',
      content: 'hello from A',
    })
    useAppStore.getState().addSessionMessage('session-B', {
      role: 'user',
      content: 'hello from B',
    })

    const stateA = useAppStore.getState().sessionMessages['session-A'] ?? []
    const stateB = useAppStore.getState().sessionMessages['session-B'] ?? []

    expect(stateA).toHaveLength(1)
    expect(stateB).toHaveLength(1)
    expect(stateA[0].content).toBe('hello from A')
    expect(stateB[0].content).toBe('hello from B')
  })

  it('clearSessionMessages removes only that session', () => {
    useAppStore.getState().addSessionMessage('s1', { role: 'user', content: 'msg' })
    useAppStore.getState().addSessionMessage('s2', { role: 'user', content: 'msg2' })
    useAppStore.getState().clearSessionMessages('s1')

    expect(useAppStore.getState().sessionMessages['s1']).toBeUndefined()
    expect(useAppStore.getState().sessionMessages['s2']).toHaveLength(1)
  })
})

// ── streaming flag lifecycle ───────────────────────────────────────────────────

describe('streamingSet lifecycle', () => {
  beforeEach(freshState)

  it('startStreaming adds session to streamingSet', () => {
    useAppStore.setState({ sessionId: 'sid-1' })
    useAppStore.getState().startStreaming('sid-1')

    expect(useAppStore.getState().streamingSet['sid-1']).toBe(true)
    expect(useAppStore.getState().isStreaming).toBe(true)
  })

  it('stopStreaming removes session from streamingSet', () => {
    useAppStore.setState({ sessionId: 'sid-1' })
    useAppStore.getState().startStreaming('sid-1')
    useAppStore.getState().stopStreaming('sid-1')

    expect(useAppStore.getState().streamingSet['sid-1']).toBeUndefined()
    expect(useAppStore.getState().isStreaming).toBe(false)
  })

  it('streaming flag is not stuck after stopStreaming', () => {
    useAppStore.setState({ sessionId: 'sid-2' })
    useAppStore.getState().startStreaming('sid-2')
    useAppStore.getState().stopStreaming('sid-2')

    // streamingSet must be empty — not just falsy
    expect(Object.keys(useAppStore.getState().streamingSet)).toHaveLength(0)
  })

  it('multiple sessions can stream simultaneously', () => {
    useAppStore.getState().startStreaming('s1')
    useAppStore.getState().startStreaming('s2')

    expect(useAppStore.getState().streamingSet['s1']).toBe(true)
    expect(useAppStore.getState().streamingSet['s2']).toBe(true)

    useAppStore.getState().stopStreaming('s1')
    expect(useAppStore.getState().streamingSet['s1']).toBeUndefined()
    expect(useAppStore.getState().streamingSet['s2']).toBe(true)
  })
})

// ── addSessionMessage assigns id and timestamp ────────────────────────────────

describe('addSessionMessage', () => {
  beforeEach(freshState)

  it('automatically assigns id and timestamp', () => {
    useAppStore.getState().addSessionMessage('sess', { role: 'assistant', content: 'hi' })
    const msgs = useAppStore.getState().sessionMessages['sess'] ?? []
    expect(msgs[0].id).toBeTruthy()
    expect(msgs[0].timestamp).toBeInstanceOf(Date)
  })

  it('appends messages in order', () => {
    useAppStore.getState().addSessionMessage('sess', { role: 'user', content: 'first' })
    useAppStore.getState().addSessionMessage('sess', { role: 'assistant', content: 'second' })
    const msgs = useAppStore.getState().sessionMessages['sess'] ?? []
    expect(msgs[0].content).toBe('first')
    expect(msgs[1].content).toBe('second')
  })
})

// ── prependSessionMessages ────────────────────────────────────────────────────

describe('prependSessionMessages', () => {
  beforeEach(freshState)

  it('prepends older messages before existing ones', () => {
    useAppStore
      .getState()
      .setSessionMessages('s', [{ id: '2', role: 'user', content: 'newer', timestamp: new Date() }])
    useAppStore
      .getState()
      .prependSessionMessages('s', [
        { id: '1', role: 'user', content: 'older', timestamp: new Date() },
      ])

    const msgs = useAppStore.getState().sessionMessages['s'] ?? []
    expect(msgs[0].content).toBe('older')
    expect(msgs[1].content).toBe('newer')
  })
})

// ── selectedModel ─────────────────────────────────────────────────────────────

describe('selectedModel', () => {
  beforeEach(() => {
    useAppStore.setState({ selectedModel: null })
    localStorage.clear()
  })

  it('defaults to null', () => {
    expect(useAppStore.getState().selectedModel).toBeNull()
  })

  it('setSelectedModel updates the value', () => {
    useAppStore.getState().setSelectedModel('mistral:7b')
    expect(useAppStore.getState().selectedModel).toBe('mistral:7b')
  })

  it('setSelectedModel can be cleared back to null', () => {
    useAppStore.getState().setSelectedModel('llama3:8b')
    useAppStore.getState().setSelectedModel(null)
    expect(useAppStore.getState().selectedModel).toBeNull()
  })

  it('selectedModel is independent of sessionId', () => {
    useAppStore.setState({ sessionId: 'sess-a' })
    useAppStore.getState().setSelectedModel('phi3:mini')

    // Switch session — model should not change
    useAppStore.setState({ sessionId: 'sess-b' })
    expect(useAppStore.getState().selectedModel).toBe('phi3:mini')
  })

  it('selectedModel is written to localStorage (persisted)', () => {
    useAppStore.getState().setSelectedModel('gemma2:9b')

    // The persist middleware writes to localStorage on every setState.
    const stored = localStorage.getItem('lyndon-llm-store')
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!)
    expect(parsed?.state?.selectedModel).toBe('gemma2:9b')
  })
})

// ── auth & logout ─────────────────────────────────────────────────────────────

describe('auth — setUser and logout', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: null,
      sessionId: null,
      sessionMessages: {},
      drafts: {},
      streamingSet: {},
      isStreaming: false,
    })
  })

  it('setUser stores the user object', () => {
    const user = { id: 'u1', username: 'alice', email: null, token: 'tok' }
    useAppStore.getState().setUser(user)
    expect(useAppStore.getState().user).toEqual(user)
  })

  it('setUser(null) clears the user', () => {
    useAppStore.setState({ user: { id: 'u1', username: 'a', email: null, token: 't' } })
    useAppStore.getState().setUser(null)
    expect(useAppStore.getState().user).toBeNull()
  })

  it('logout clears user, sessionId, messages, drafts, and streaming state', () => {
    useAppStore.setState({
      user: { id: 'u1', username: 'alice', email: null, token: 't' },
      sessionId: 'sid-x',
      sessionMessages: { 'sid-x': [] },
      drafts: { 'sid-x': 'draft text' },
      streamingSet: { 'sid-x': true },
      isStreaming: true,
    })

    useAppStore.getState().logout()

    const s = useAppStore.getState()
    expect(s.user).toBeNull()
    expect(s.sessionId).toBeNull()
    expect(s.sessionMessages).toEqual({})
    expect(s.drafts).toEqual({})
    expect(s.streamingSet).toEqual({})
    expect(s.isStreaming).toBe(false)
  })
})

// ── drafts ────────────────────────────────────────────────────────────────────

describe('drafts', () => {
  beforeEach(() => useAppStore.setState({ drafts: {} }))

  it('setDraft stores text for a session key', () => {
    useAppStore.getState().setDraft('sess-1', 'hello world')
    expect(useAppStore.getState().drafts['sess-1']).toBe('hello world')
  })

  it('clearDraft removes the key', () => {
    useAppStore.setState({ drafts: { 'sess-1': 'hello', 'sess-2': 'bye' } })
    useAppStore.getState().clearDraft('sess-1')
    expect(useAppStore.getState().drafts['sess-1']).toBeUndefined()
    expect(useAppStore.getState().drafts['sess-2']).toBe('bye')
  })

  it('multiple sessions have independent drafts', () => {
    useAppStore.getState().setDraft('a', 'draft A')
    useAppStore.getState().setDraft('b', 'draft B')
    expect(useAppStore.getState().drafts['a']).toBe('draft A')
    expect(useAppStore.getState().drafts['b']).toBe('draft B')
  })
})

// ── pinned sessions ───────────────────────────────────────────────────────────

describe('pinnedSessionIds', () => {
  beforeEach(() => useAppStore.setState({ pinnedSessionIds: [] }))

  it('pinSession prepends the id', () => {
    useAppStore.getState().pinSession('sid-1')
    useAppStore.getState().pinSession('sid-2')
    expect(useAppStore.getState().pinnedSessionIds).toEqual(['sid-2', 'sid-1'])
  })

  it('pinSession is idempotent — no duplicates', () => {
    useAppStore.getState().pinSession('sid-1')
    useAppStore.getState().pinSession('sid-1')
    expect(useAppStore.getState().pinnedSessionIds).toHaveLength(1)
  })

  it('unpinSession removes the id', () => {
    useAppStore.setState({ pinnedSessionIds: ['sid-1', 'sid-2'] })
    useAppStore.getState().unpinSession('sid-1')
    expect(useAppStore.getState().pinnedSessionIds).toEqual(['sid-2'])
  })

  it('unpinSession on unknown id is a no-op', () => {
    useAppStore.setState({ pinnedSessionIds: ['sid-1'] })
    useAppStore.getState().unpinSession('ghost')
    expect(useAppStore.getState().pinnedSessionIds).toEqual(['sid-1'])
  })
})

// ── system & session prompts ───────────────────────────────────────────────────

describe('prompts', () => {
  beforeEach(() =>
    useAppStore.setState({ systemPrompt: '', sessionPrompts: {}, appliedSessionPrompts: {} }),
  )

  it('setSystemPrompt updates the global prompt', () => {
    useAppStore.getState().setSystemPrompt('Always respond in French.')
    expect(useAppStore.getState().systemPrompt).toBe('Always respond in French.')
  })

  it('setSessionPrompt stores a per-session prompt', () => {
    useAppStore.getState().setSessionPrompt('sess-1', 'Translate everything to Spanish.')
    expect(useAppStore.getState().sessionPrompts['sess-1']).toBe(
      'Translate everything to Spanish.',
    )
  })

  it('clearSessionPrompt removes the key without affecting others', () => {
    useAppStore.setState({ sessionPrompts: { a: 'prompt A', b: 'prompt B' } })
    useAppStore.getState().clearSessionPrompt('a')
    expect(useAppStore.getState().sessionPrompts['a']).toBeUndefined()
    expect(useAppStore.getState().sessionPrompts['b']).toBe('prompt B')
  })

  it('setAppliedSessionPrompt records which prompt was applied', () => {
    useAppStore.getState().setAppliedSessionPrompt('sess-1', 'the prompt that was used')
    expect(useAppStore.getState().appliedSessionPrompts['sess-1']).toBe('the prompt that was used')
  })
})

// ── effort mode ───────────────────────────────────────────────────────────────

describe('effortMode', () => {
  beforeEach(() => useAppStore.setState({ effortMode: 'medium', sessionEffortModes: {} }))

  it('defaults to medium', () => {
    expect(useAppStore.getState().effortMode).toBe('medium')
  })

  it('setEffortMode updates the global effort', () => {
    useAppStore.getState().setEffortMode('high')
    expect(useAppStore.getState().effortMode).toBe('high')
  })

  it('setSessionEffortMode stores a per-session override', () => {
    useAppStore.getState().setSessionEffortMode('s1', 'low')
    expect(useAppStore.getState().sessionEffortModes['s1']).toBe('low')
  })

  it('per-session overrides are independent', () => {
    useAppStore.getState().setSessionEffortMode('s1', 'low')
    useAppStore.getState().setSessionEffortMode('s2', 'high')
    expect(useAppStore.getState().sessionEffortModes['s1']).toBe('low')
    expect(useAppStore.getState().sessionEffortModes['s2']).toBe('high')
  })
})

// ── chat planner ──────────────────────────────────────────────────────────────

describe('chatPlanner', () => {
  beforeEach(() =>
    useAppStore.setState({
      chatPendingPlan: null,
      chatPlanStatus: null,
      chatPlanStepStatuses: {},
    }),
  )

  const fakePlan = {
    plan_id: 'p1',
    steps: [{ step_id: 's1', description: 'step one' }],
  } as never

  it('setChatPendingPlan stores the plan and resets step statuses', () => {
    useAppStore.setState({ chatPlanStepStatuses: { 's1': 'done' as never } })
    useAppStore.getState().setChatPendingPlan(fakePlan)
    expect(useAppStore.getState().chatPendingPlan).toEqual(fakePlan)
    expect(useAppStore.getState().chatPlanStepStatuses).toEqual({})
  })

  it('updateChatPlanStepStatus updates a single step', () => {
    useAppStore.getState().updateChatPlanStepStatus('s1', 'running' as never)
    expect(useAppStore.getState().chatPlanStepStatuses['s1']).toBe('running')
  })

  it('clearChatPlan resets everything', () => {
    useAppStore.setState({
      chatPendingPlan: fakePlan,
      chatPlanStatus: 'running' as never,
      chatPlanStepStatuses: { s1: 'done' as never },
    })
    useAppStore.getState().clearChatPlan()
    expect(useAppStore.getState().chatPendingPlan).toBeNull()
    expect(useAppStore.getState().chatPlanStatus).toBeNull()
    expect(useAppStore.getState().chatPlanStepStatuses).toEqual({})
  })
})
