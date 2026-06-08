/**
 * useSpeech hook — text-to-speech wrapper over the browser SpeechSynthesis API.
 *
 * The Web Speech API is not implemented in jsdom, so we install a minimal fake
 * on window before importing the hook (it reads speechSynthesis at module load).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── fake SpeechSynthesis, installed before the hook module is imported ──────────

class FakeUtterance {
  text: string
  lang = ''
  voice: unknown = null
  rate = 1
  pitch = 1
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

const speak = vi.fn()
const cancel = vi.fn()
const getVoices = vi.fn(() => [
  { name: 'Samantha', lang: 'en-US', localService: true },
  { name: 'Compact Fred', lang: 'en-US', localService: true },
  { name: 'Tingting', lang: 'zh-CN', localService: true },
])

vi.stubGlobal('speechSynthesis', {
  speak,
  cancel,
  getVoices,
  addEventListener: vi.fn(),
})
vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)

// Import AFTER the globals are in place (module reads speechSynthesis at load).
const { renderHook, act } = await import('@testing-library/react')
const { useSpeech } = await import('../useSpeech')

beforeEach(() => {
  vi.clearAllMocks()
})

// ── support detection ───────────────────────────────────────────────────────────

describe('useSpeech — support', () => {
  it('reports supported when speechSynthesis is present', () => {
    const { result } = renderHook(() => useSpeech('hello'))
    expect(result.current.supported).toBe(true)
    expect(result.current.speaking).toBe(false)
  })
})

// ── toggle behaviour ────────────────────────────────────────────────────────────

describe('useSpeech — toggle', () => {
  it('starts speaking and sets the speaking flag', () => {
    const { result } = renderHook(() => useSpeech('hello world'))

    act(() => result.current.toggle())

    expect(speak).toHaveBeenCalledOnce()
    expect(result.current.speaking).toBe(true)
  })

  it('cancels any in-progress speech before starting a new utterance', () => {
    const { result } = renderHook(() => useSpeech('hello'))
    act(() => result.current.toggle())
    // cancel is called once defensively before speaking
    expect(cancel).toHaveBeenCalled()
  })

  it('toggling again while speaking stops playback', () => {
    const { result } = renderHook(() => useSpeech('hello'))
    act(() => result.current.toggle()) // start
    cancel.mockClear()
    act(() => result.current.toggle()) // stop

    expect(cancel).toHaveBeenCalledOnce()
    expect(result.current.speaking).toBe(false)
  })

  it('infers zh-CN for CJK text', () => {
    const { result } = renderHook(() => useSpeech('你好世界'))
    act(() => result.current.toggle())

    const utterance = speak.mock.calls[0][0] as FakeUtterance
    expect(utterance.lang).toBe('zh-CN')
  })

  it('infers en-US for Latin text', () => {
    const { result } = renderHook(() => useSpeech('hello there'))
    act(() => result.current.toggle())

    const utterance = speak.mock.calls[0][0] as FakeUtterance
    expect(utterance.lang).toBe('en-US')
  })

  it('selects a premium voice over the compact variant', () => {
    const { result } = renderHook(() => useSpeech('hello'))
    act(() => result.current.toggle())

    const utterance = speak.mock.calls[0][0] as FakeUtterance
    expect((utterance.voice as { name: string }).name).toBe('Samantha')
  })

  it('clears the speaking flag when the utterance ends', () => {
    const { result } = renderHook(() => useSpeech('hello'))
    act(() => result.current.toggle())
    const utterance = speak.mock.calls[0][0] as FakeUtterance

    act(() => utterance.onend?.())
    expect(result.current.speaking).toBe(false)
  })

  it('clears the speaking flag on utterance error', () => {
    const { result } = renderHook(() => useSpeech('hello'))
    act(() => result.current.toggle())
    const utterance = speak.mock.calls[0][0] as FakeUtterance

    act(() => utterance.onerror?.())
    expect(result.current.speaking).toBe(false)
  })
})
