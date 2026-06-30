// Runtime platform detection.
//
// IS_TAURI is true in BOTH the desktop app and the mobile (Android/iOS) app,
// so it can't be used to gate desktop-only features. IS_DESKTOP is the right
// flag for those (filesystem, Cowork/Code modes, desktop_control).

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

// iPadOS 13+ reports a desktop ("Macintosh") user-agent, so the regex alone
// misses iPads — fall back to the touch-points heuristic (a real Mac reports 0).
const IS_IOS =
  /iphone|ipad|ipod/i.test(ua) ||
  (typeof navigator !== 'undefined' &&
    navigator.platform === 'MacIntel' &&
    navigator.maxTouchPoints > 1)

export const IS_TAURI =
  typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'

export const IS_MOBILE = /android/i.test(ua) || IS_IOS

/** True only for the desktop Tauri build (not web, not mobile). */
export const IS_DESKTOP = IS_TAURI && !IS_MOBILE
