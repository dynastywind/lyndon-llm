/**
 * relTime — compact relative-time formatting.
 * Uses fake timers to pin "now" so the boundaries are deterministic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { relTime } from '../util'

const NOW = new Date('2026-06-08T12:00:00.000Z').getTime()

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('relTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "Just now" for under a minute', () => {
    expect(relTime(ago(30 * SEC))).toBe('Just now')
  })

  it('returns minutes for under an hour', () => {
    expect(relTime(ago(5 * MIN))).toBe('5m ago')
    expect(relTime(ago(59 * MIN))).toBe('59m ago')
  })

  it('returns hours for under a day', () => {
    expect(relTime(ago(3 * HOUR))).toBe('3h ago')
    expect(relTime(ago(23 * HOUR))).toBe('23h ago')
  })

  it('returns "Yesterday" at exactly one day', () => {
    expect(relTime(ago(DAY))).toBe('Yesterday')
  })

  it('returns days for 2–6 days', () => {
    expect(relTime(ago(3 * DAY))).toBe('3d ago')
    expect(relTime(ago(6 * DAY))).toBe('6d ago')
  })

  it('falls back to a locale date string at 7+ days', () => {
    const out = relTime(ago(8 * DAY))
    expect(out).toBe(new Date(NOW - 8 * DAY).toLocaleDateString())
    expect(out).not.toContain('ago')
  })

  it('crosses the minute boundary exactly at 60 minutes', () => {
    expect(relTime(ago(60 * MIN))).toBe('1h ago')
  })
})
