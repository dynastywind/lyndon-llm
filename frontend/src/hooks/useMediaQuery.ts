import { useEffect, useState } from 'react'

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

/** Narrow (phone-ish) viewport — drives the mobile drawer layout. */
export function useIsNarrow(): boolean {
  return useMediaQuery('(max-width: 768px)')
}
