// Lightweight, zero-dependency i18n engine backed by the Zustand store.
// `en` is the source of truth for all keys; `zh` is typed against it so the
// compiler flags any drift. A missing zh key degrades gracefully to English.

import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { en } from './en'
import { zh } from './zh'

export type Language = 'en' | 'zh'

const DICTS: Record<Language, unknown> = { en, zh }

type Vars = Record<string, string | number>

function pick(dict: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict)
}

function interpolate(str: string, vars?: Vars): string {
  if (!vars) return str
  let out = str
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v))
  }
  return out
}

// dot-path lookup with English fallback + `{var}` interpolation
export function translate(lang: Language, key: string, vars?: Vars): string {
  let val = pick(DICTS[lang] ?? en, key)
  if (typeof val !== 'string') val = pick(en, key)
  return interpolate(typeof val === 'string' ? val : key, vars)
}

// plural helper: picks `${key}_one` vs `${key}_other` (English).
// Chinese supplies a single form for both, so both suffixes resolve fine.
export function translateN(lang: Language, key: string, count: number, vars?: Vars): string {
  return translate(lang, `${key}${count === 1 ? '_one' : '_other'}`, { ...vars, count })
}

export function useT() {
  const language = useAppStore((s) => s.language)
  return useMemo(
    () => ({
      t: (key: string, vars?: Vars) => translate(language, key, vars),
      tn: (key: string, count: number, vars?: Vars) => translateN(language, key, count, vars),
      language,
    }),
    [language],
  )
}
