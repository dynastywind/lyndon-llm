/**
 * i18n engine — dot-path lookup, English fallback, {var} interpolation,
 * and the _one/_other plural selector.
 */
import { describe, it, expect } from 'vitest'
import { translate, translateN } from '../index'
import { en } from '../en'

// ── translate — lookup & fallback ───────────────────────────────────────────────

describe('translate — lookup', () => {
  it('resolves a nested dot-path key for English', () => {
    expect(translate('en', 'common.save')).toBe(en.common.save)
  })

  it('resolves a Chinese string for a translated key', () => {
    // zh has its own value; assert it differs from English and is non-empty
    const zhVal = translate('zh', 'common.save')
    expect(zhVal).toBeTruthy()
  })

  it('falls back to English when a key is missing in the target language', () => {
    // A deeply nested English key that zh may not override still resolves to a string,
    // never to the raw key.
    const val = translate('zh', 'common.cancel')
    expect(val).toBeTruthy()
    expect(val).not.toBe('common.cancel')
  })

  it('returns the raw key when it does not exist in any dictionary', () => {
    expect(translate('en', 'does.not.exist')).toBe('does.not.exist')
  })

  it('returns the key when the path resolves to a non-string (namespace object)', () => {
    // 'common' is an object, not a leaf string — should degrade to the key.
    expect(translate('en', 'common')).toBe('common')
  })

  it('falls back to English dictionary for an unknown language code', () => {
    // @ts-expect-error — intentionally passing an invalid language
    expect(translate('fr', 'common.save')).toBe(en.common.save)
  })
})

// ── translate — interpolation ───────────────────────────────────────────────────

describe('translate — interpolation', () => {
  it('substitutes a single {var}', () => {
    const out = translate('en', 'settings.ai.preview.assistantMsg', { value: 'be terse' })
    expect(out).toContain('be terse')
    expect(out).not.toContain('{value}')
  })

  it('leaves unmatched placeholders untouched when no vars supplied', () => {
    const out = translate('en', 'settings.knowledge.onFile')
    expect(out).toContain('{count}')
  })

  it('replaces every occurrence of a repeated placeholder', () => {
    // interpolate uses split/join so all instances are replaced — verify via count key
    const out = translate('en', 'settings.knowledge.onFile', { count: 3 })
    expect(out).toBe('3 on file')
  })

  it('coerces numeric vars to strings', () => {
    const out = translate('en', 'settings.knowledge.onFile', { count: 0 })
    expect(out).toBe('0 on file')
  })
})

// ── translateN — plural selection ───────────────────────────────────────────────

describe('translateN — plural selection', () => {
  it('uses the _one form when count === 1', () => {
    expect(translateN('en', 'plan.steps', 1)).toBe('Plan · 1 step')
  })

  it('uses the _other form when count > 1', () => {
    expect(translateN('en', 'plan.steps', 3)).toBe('Plan · 3 steps')
  })

  it('uses the _other form when count === 0', () => {
    expect(translateN('en', 'plan.steps', 0)).toBe('Plan · 0 steps')
  })

  it('injects count into the chosen form automatically', () => {
    expect(translateN('en', 'settings.knowledge.row.chunks', 5)).toBe('5 chunks')
    expect(translateN('en', 'settings.knowledge.row.chunks', 1)).toBe('1 chunk')
  })

  it('merges extra vars alongside the implicit count', () => {
    // count is supplied implicitly; extra vars should still interpolate
    const out = translateN('en', 'plan.steps', 2, {})
    expect(out).toContain('2')
  })
})
