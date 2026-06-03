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
