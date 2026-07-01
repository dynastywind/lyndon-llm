import { useEffect, useState } from 'react'
import { IS_MOBILE } from '@/lib/platform'

/** Subscribe to a CSS media query. Returns whether it currently matches. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/**
 * Narrow (phone-ish) layout — drives the mobile drawer / full-screen dialogs.
 *
 * Also forced on any real mobile device: a mobile webview can report a layout
 * viewport wider than 768px, which would otherwise leave it stuck on the
 * cramped desktop two-column layout.
 */
export function useIsNarrow(): boolean {
  const narrow = useMediaQuery('(max-width: 768px)')
  return narrow || IS_MOBILE
}
