import { useCallback, useEffect, useRef, useState } from 'react'

const CJK = /[一-鿿]/

// Higher-quality OS voices, in rough preference order. The browser default is
// often a low-quality "compact" voice, which is why unselected TTS sounds odd.
const PREFERRED: Record<string, string[]> = {
  en: ['Samantha', 'Ava', 'Allison', 'Zoe', 'Evan', 'Alex', 'Tom', 'Karen', 'Daniel'],
  zh: ['Tingting', 'Ting-Ting', 'Sinji', 'Meijia', 'Yu-shu', 'Li-mu'],
}

// `getVoices()` is populated asynchronously (empty until `voiceschanged`), so
// cache the list and keep it fresh.
let cachedVoices: SpeechSynthesisVoice[] = []
function refreshVoices() {
  const v = window.speechSynthesis.getVoices()
  if (v.length) cachedVoices = v
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices)
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (!cachedVoices.length) refreshVoices()
  const base = lang.split('-')[0]
  const matches = cachedVoices.filter((v) => v.lang.toLowerCase().startsWith(base))
  if (!matches.length) return null

  const preferred = PREFERRED[base] ?? []
  const score = (v: SpeechSynthesisVoice): number => {
    let s = 0
    if (v.lang.toLowerCase() === lang.toLowerCase()) s += 4 // exact region match
    const idx = preferred.findIndex((n) => v.name.toLowerCase().includes(n.toLowerCase()))
    if (idx >= 0) s += 10 - idx // named premium voice (earlier = better)
    if (/compact|eloquence/i.test(v.name)) s -= 5 // low-quality variants
    if (v.localService) s += 1 // on-device: offline + low latency
    return s
  }
  return matches.slice().sort((a, b) => score(b) - score(a))[0] ?? null
}

/**
 * Text-to-speech for a single piece of text via the browser's SpeechSynthesis
 * API (uses the OS voices — works in the desktop webview and the browser, no
 * backend). Language is inferred from the text (CJK → zh-CN) and the best
 * available voice for that language is selected.
 */
export function useSpeech(text: string) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [speaking, setSpeaking] = useState(false)
  const speakingRef = useRef(false)
  speakingRef.current = speaking

  const toggle = useCallback(() => {
    if (!supported) return
    if (speakingRef.current) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    window.speechSynthesis.cancel() // stop any other message being read
    const lang = CJK.test(text) ? 'zh-CN' : 'en-US'
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    const voice = pickVoice(lang)
    if (voice) utterance.voice = voice
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }, [supported, text])

  // Stop this instance's speech if it unmounts mid-read.
  useEffect(
    () => () => {
      if (speakingRef.current) window.speechSynthesis.cancel()
    },
    [],
  )

  return { supported, speaking, toggle }
}
