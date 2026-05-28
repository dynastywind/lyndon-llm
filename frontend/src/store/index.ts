import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateId } from '@/lib/utils'
import type { Mode, Message, Plan, FileDiff } from '@/types'
import { CODE_THEME_DEFAULT } from '@/config/codeThemes'
import type { CodeThemeName } from '@/config/codeThemes'

interface AppState {
  // Session
  sessionId: string
  setSessionId: (id: string) => void
  mode: Mode
  setMode: (mode: Mode) => void

  // Chat
  messages: Message[]
  addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => void
  setMessages: (msgs: Message[]) => void
  prependMessages: (msgs: Message[]) => void
  clearMessages: () => void
  isStreaming: boolean
  setStreaming: (v: boolean) => void

  // Signal ChatWindow to scroll to bottom (incremented, not boolean)
  scrollToBottomTick: number
  bumpScrollToBottom: () => void

  // Used by Sidebar to know when to refresh the sessions list
  sessionListVersion: number
  bumpSessionVersion: () => void

  // Cowork
  currentPlan: Plan | null
  setPlan: (plan: Plan | null) => void

  // Code
  currentDiff: FileDiff | null
  setDiff: (diff: FileDiff | null) => void
  repoPath: string
  setRepoPath: (path: string) => void

  // Appearance
  codeTheme: CodeThemeName
  setCodeTheme: (theme: CodeThemeName) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Session
      sessionId: generateId(),
      setSessionId: (id) => set({ sessionId: id }),
      mode: 'chat',
      setMode: (mode) => set({ mode }),

      // Chat
      messages: [],
      addMessage: (msg) =>
        set((s) => ({
          messages: [
            ...s.messages,
            { ...msg, id: generateId(), timestamp: new Date() },
          ],
        })),
      setMessages: (msgs) => set({ messages: msgs }),
      prependMessages: (msgs) =>
        set((s) => ({ messages: [...msgs, ...s.messages] })),
      clearMessages: () => set({ messages: [] }),
      isStreaming: false,
      setStreaming: (v) => set({ isStreaming: v }),

      scrollToBottomTick: 0,
      bumpScrollToBottom: () =>
        set((s) => ({ scrollToBottomTick: s.scrollToBottomTick + 1 })),

      sessionListVersion: 0,
      bumpSessionVersion: () =>
        set((s) => ({ sessionListVersion: s.sessionListVersion + 1 })),

      // Cowork
      currentPlan: null,
      setPlan: (plan) => set({ currentPlan: plan }),

      // Code
      currentDiff: null,
      setDiff: (diff) => set({ currentDiff: diff }),
      repoPath: '',
      setRepoPath: (path) => set({ repoPath: path }),

      // Appearance
      codeTheme: CODE_THEME_DEFAULT,
      setCodeTheme: (codeTheme) => set({ codeTheme }),
    }),
    {
      name: 'lyndon-llm-store',
      partialize: (s) => ({ sessionId: s.sessionId, repoPath: s.repoPath, codeTheme: s.codeTheme }),
    },
  ),
)
