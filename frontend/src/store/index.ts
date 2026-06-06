import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateId } from '@/lib/utils'
import type {
  Mode,
  Message,
  Plan,
  FileDiff,
  ChatPlan,
  ChatPlanStatus,
  ChatPlanStepStatus,
} from '@/types'
import { CODE_THEME_DEFAULT } from '@/config/codeThemes'
import type { CodeThemeName } from '@/config/codeThemes'

export interface AuthUser {
  id: string
  username: string
  email: string | null
  oauth_provider?: string | null
  token: string
}

interface AppState {
  // Auth
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
  logout: () => void
  /** Non-null when an OAuth callback needs the user to choose a username. */
  pendingOAuthToken: string | null
  setPendingOAuthToken: (token: string | null) => void

  // Session
  sessionId: string | null
  setSessionId: (id: string | null) => void
  sessionTitle: string | null
  setSessionTitle: (title: string | null) => void
  mode: Mode
  setMode: (mode: Mode) => void

  // Per-session messages — each session owns its own array.
  // ChatWindow derives its view as sessionMessages[sessionId ?? '__new__'] ?? []
  sessionMessages: Record<string, Message[]>
  addSessionMessage: (sid: string, msg: Omit<Message, 'id' | 'timestamp'>) => void
  setSessionMessages: (sid: string, msgs: Message[]) => void
  prependSessionMessages: (sid: string, msgs: Message[]) => void
  clearSessionMessages: (sid: string) => void

  /** @deprecated use per-session helpers; kept for CoworkWindow / CodeWindow */
  messages: Message[]
  /** @deprecated */ addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => void
  /** @deprecated */ setMessages: (msgs: Message[]) => void
  /** @deprecated */ prependMessages: (msgs: Message[]) => void
  /** @deprecated */ clearMessages: () => void

  /** Sessions currently receiving a streaming response, keyed by sessionId. */
  streamingSet: Record<string, boolean>
  startStreaming: (sessionId: string) => void
  stopStreaming: (sessionId: string) => void
  /** Kept for components that read isStreaming directly; auto-updated on session switch. */
  isStreaming: boolean
  /** @deprecated use startStreaming / stopStreaming */
  setStreaming: (v: boolean) => void

  // Signal ChatWindow to scroll to bottom (incremented, not boolean)
  scrollToBottomTick: number
  bumpScrollToBottom: () => void

  // Used by Sidebar to know when to refresh the sessions list
  sessionListVersion: number
  bumpSessionVersion: () => void

  // Incremented every time we navigate to the home screen (delete / new chat).
  // Used as part of the window key in App.tsx to guarantee a full remount.
  homeVersion: number
  bumpHomeVersion: () => void

  // Cowork
  currentPlan: Plan | null
  setPlan: (plan: Plan | null) => void

  // Chat Planner
  chatPendingPlan: ChatPlan | null
  chatPlanStatus: ChatPlanStatus | null
  chatPlanStepStatuses: Record<string, ChatPlanStepStatus>
  setChatPendingPlan: (plan: ChatPlan | null) => void
  setChatPlanStatus: (status: ChatPlanStatus | null) => void
  updateChatPlanStepStatus: (stepId: string, status: ChatPlanStepStatus) => void
  clearChatPlan: () => void

  // Code
  currentDiff: FileDiff | null
  setDiff: (diff: FileDiff | null) => void
  repoPath: string
  setRepoPath: (path: string) => void

  // Per-session input drafts (keyed by sessionId or '__new__')
  drafts: Record<string, string>
  setDraft: (key: string, text: string) => void
  clearDraft: (key: string) => void

  // Model selection
  selectedModel: string | null
  setSelectedModel: (model: string | null) => void

  // Effort mode — controls how verbose/thorough the model's responses are
  effortMode: 'low' | 'medium' | 'high'
  setEffortMode: (mode: 'low' | 'medium' | 'high') => void
  /**
   * Per-session effort overrides — keyed by sessionId.
   * When entering a session that has a saved effort, it is restored as the
   * active effortMode so that thread-specific settings survive navigation.
   */
  sessionEffortModes: Record<string, 'low' | 'medium' | 'high'>
  setSessionEffortMode: (sessionId: string, mode: 'low' | 'medium' | 'high') => void

  // Pinned session IDs — order-preserving; persisted to localStorage
  pinnedSessionIds: string[]
  pinSession: (id: string) => void
  unpinSession: (id: string) => void

  // Prompts
  /** Global system prompt — appended to BASE_SYSTEM_PROMPT on every request. Persisted. */
  systemPrompt: string
  setSystemPrompt: (text: string) => void
  /** Per-session prompts — quoted into the first message of each session. Not persisted. */
  sessionPrompts: Record<string, string>
  setSessionPrompt: (key: string, text: string) => void
  clearSessionPrompt: (key: string) => void
  /**
   * Prompts that were actually applied to a session's first message.
   * Keyed by sessionId. Persisted — survives reload so the context panel
   * can still show what prompt was used even after the session prompt is consumed.
   */
  appliedSessionPrompts: Record<string, string>
  setAppliedSessionPrompt: (sessionId: string, text: string) => void

  // Appearance
  codeTheme: CodeThemeName
  setCodeTheme: (theme: CodeThemeName) => void
  uiTheme: 'dark' | 'light'
  setUiTheme: (theme: 'dark' | 'light') => void
  language: 'en' | 'zh'
  setLanguage: (language: 'en' | 'zh') => void

  // Profile
  profession: string
  setProfession: (text: string) => void
  /** Incremented after each successful avatar upload — used as a cache-buster in the img URL. 0 = no avatar. */
  avatarVersion: number
  setAvatarVersion: (v: number) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // ── Auth ─────────────────────────────────────────────────────────
      user: null,
      setUser: (user) => set({ user }),
      pendingOAuthToken: null,
      setPendingOAuthToken: (token) => set({ pendingOAuthToken: token }),
      logout: () =>
        set({
          user: null,
          sessionId: null,
          sessionTitle: null,
          sessionMessages: {},
          drafts: {},
          streamingSet: {},
          isStreaming: false,
        }),

      // ── Session ──────────────────────────────────────────────────────
      sessionId: null,
      setSessionId: (id) => set({ sessionId: id }),
      sessionTitle: null,
      setSessionTitle: (title) => set({ sessionTitle: title }),
      mode: 'chat',
      setMode: (mode) => set({ mode }),

      // ── Per-session messages ──────────────────────────────────────────
      sessionMessages: {},

      addSessionMessage: (sid, msg) =>
        set((s) => ({
          sessionMessages: {
            ...s.sessionMessages,
            [sid]: [
              ...(s.sessionMessages[sid] ?? []),
              { ...msg, id: generateId(), timestamp: new Date() },
            ],
          },
        })),

      setSessionMessages: (sid, msgs) =>
        set((s) => ({ sessionMessages: { ...s.sessionMessages, [sid]: msgs } })),

      prependSessionMessages: (sid, msgs) =>
        set((s) => ({
          sessionMessages: {
            ...s.sessionMessages,
            [sid]: [...msgs, ...(s.sessionMessages[sid] ?? [])],
          },
        })),

      clearSessionMessages: (sid) =>
        set((s) => {
          const next = { ...s.sessionMessages }
          delete next[sid]
          return { sessionMessages: next }
        }),

      // ── Deprecated message helpers (Cowork / Code still use these) ────
      messages: [],
      addMessage: (msg) =>
        set((s) => ({
          messages: [...s.messages, { ...msg, id: generateId(), timestamp: new Date() }],
        })),
      setMessages: (msgs) => set({ messages: msgs }),
      prependMessages: (msgs) => set((s) => ({ messages: [...msgs, ...s.messages] })),
      clearMessages: () => set({ messages: [] }),

      // ── Streaming state ───────────────────────────────────────────────
      streamingSet: {},
      startStreaming: (id) =>
        set((s) => ({
          streamingSet: { ...s.streamingSet, [id]: true },
          // keep isStreaming in sync for the current session
          isStreaming: s.sessionId === id ? true : s.isStreaming,
        })),
      stopStreaming: (id) =>
        set((s) => {
          const next = { ...s.streamingSet }
          delete next[id]
          return {
            streamingSet: next,
            isStreaming: next[s.sessionId ?? '__new__'] === true,
          }
        }),
      isStreaming: false,
      setStreaming: (v) => set({ isStreaming: v }),

      scrollToBottomTick: 0,
      bumpScrollToBottom: () => set((s) => ({ scrollToBottomTick: s.scrollToBottomTick + 1 })),

      sessionListVersion: 0,
      bumpSessionVersion: () => set((s) => ({ sessionListVersion: s.sessionListVersion + 1 })),

      homeVersion: 0,
      bumpHomeVersion: () => set((s) => ({ homeVersion: s.homeVersion + 1 })),

      // ── Cowork ────────────────────────────────────────────────────────
      currentPlan: null,
      setPlan: (plan) => set({ currentPlan: plan }),

      // ── Chat Planner ──────────────────────────────────────────────────
      chatPendingPlan: null,
      chatPlanStatus: null,
      chatPlanStepStatuses: {},
      setChatPendingPlan: (plan) => set({ chatPendingPlan: plan, chatPlanStepStatuses: {} }),
      setChatPlanStatus: (status) => set({ chatPlanStatus: status }),
      updateChatPlanStepStatus: (stepId, status) =>
        set((s) => ({
          chatPlanStepStatuses: { ...s.chatPlanStepStatuses, [stepId]: status },
        })),
      clearChatPlan: () =>
        set({ chatPendingPlan: null, chatPlanStatus: null, chatPlanStepStatuses: {} }),

      // ── Code ──────────────────────────────────────────────────────────
      currentDiff: null,
      setDiff: (diff) => set({ currentDiff: diff }),
      repoPath: '',
      setRepoPath: (path) => set({ repoPath: path }),

      // ── Per-session input drafts ──────────────────────────────────────
      drafts: {},
      setDraft: (key, text) => set((s) => ({ drafts: { ...s.drafts, [key]: text } })),
      clearDraft: (key) =>
        set((s) => {
          const drafts = { ...s.drafts }
          delete drafts[key]
          return { drafts }
        }),

      // ── Model ────────────────────────────────────────────────────────
      selectedModel: null,
      setSelectedModel: (model) => set({ selectedModel: model }),

      // ── Effort mode ───────────────────────────────────────────────────
      effortMode: 'medium',
      setEffortMode: (effortMode) => set({ effortMode }),
      sessionEffortModes: {},
      setSessionEffortMode: (sessionId, mode) =>
        set((s) => ({ sessionEffortModes: { ...s.sessionEffortModes, [sessionId]: mode } })),

      // ── Pinned sessions ───────────────────────────────────────────────────────
      pinnedSessionIds: [],
      pinSession: (id) =>
        set((s) =>
          s.pinnedSessionIds.includes(id) ? s : { pinnedSessionIds: [id, ...s.pinnedSessionIds] },
        ),
      unpinSession: (id) =>
        set((s) => ({ pinnedSessionIds: s.pinnedSessionIds.filter((x) => x !== id) })),

      // ── Prompts ───────────────────────────────────────────────────────
      systemPrompt: '',
      setSystemPrompt: (text) => set({ systemPrompt: text }),

      sessionPrompts: {},
      setSessionPrompt: (key, text) =>
        set((s) => ({ sessionPrompts: { ...s.sessionPrompts, [key]: text } })),
      clearSessionPrompt: (key) =>
        set((s) => {
          const sessionPrompts = { ...s.sessionPrompts }
          delete sessionPrompts[key]
          return { sessionPrompts }
        }),

      appliedSessionPrompts: {},
      setAppliedSessionPrompt: (sessionId, text) =>
        set((s) => ({ appliedSessionPrompts: { ...s.appliedSessionPrompts, [sessionId]: text } })),

      // ── Appearance ────────────────────────────────────────────────────
      codeTheme: CODE_THEME_DEFAULT,
      setCodeTheme: (codeTheme) => set({ codeTheme }),
      uiTheme: (localStorage.getItem('lv-theme') as 'dark' | 'light') ?? 'dark',
      setUiTheme: (uiTheme) => {
        localStorage.setItem('lv-theme', uiTheme)
        set({ uiTheme })
      },
      language: (localStorage.getItem('lv-lang') as 'en' | 'zh') ?? 'en',
      setLanguage: (language) => {
        localStorage.setItem('lv-lang', language)
        set({ language })
      },

      // ── Profile ───────────────────────────────────────────────────────
      profession: '',
      setProfession: (profession) => set({ profession }),
      avatarVersion: 0,
      setAvatarVersion: (avatarVersion) => set({ avatarVersion }),
    }),
    {
      name: 'lyndon-llm-store',
      partialize: (s) => ({
        user: s.user,
        sessionId: s.sessionId,
        repoPath: s.repoPath,
        codeTheme: s.codeTheme,
        uiTheme: s.uiTheme,
        language: s.language,
        systemPrompt: s.systemPrompt,
        appliedSessionPrompts: s.appliedSessionPrompts,
        selectedModel: s.selectedModel,
        effortMode: s.effortMode,
        sessionEffortModes: s.sessionEffortModes,
        pinnedSessionIds: s.pinnedSessionIds,
        profession: s.profession,
        avatarVersion: s.avatarVersion,
      }),
    },
  ),
)
