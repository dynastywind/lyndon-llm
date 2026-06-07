import { useCallback, useEffect, useRef, useState } from 'react'

const CJK = /[一-鿿]/

/**
 * Text-to-speech for a single piece of text via the browser's SpeechSynthesis
 * API (uses the OS voices — works in the desktop webview and the browser, no
 * backend). The utterance language is inferred from the text (CJK → zh-CN).
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
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = CJK.test(text) ? 'zh-CN' : 'en-US'
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
