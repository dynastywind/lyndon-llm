/**
 * Vitest global setup — runs before any test file is imported.
 * Polyfills localStorage so Zustand's persist middleware works in jsdom.
 */
const store: Record<string, string> = {}
const localStorageMock: Storage = {
  getItem: (key) => store[key] ?? null,
  setItem: (key, value) => {
    store[key] = String(value)
  },
  removeItem: (key) => {
    delete store[key]
  },
  clear: () => {
    for (const k of Object.keys(store)) delete store[k]
  },
  key: (index) => Object.keys(store)[index] ?? null,
  get length() {
    return Object.keys(store).length
  },
}
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})
