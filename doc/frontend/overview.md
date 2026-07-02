# Frontend — Overview

**Path**: `frontend/`
**Purpose**: React 18 single-page application — the primary user interface for all three modes (Chat, Cowork, Code) and the Sandbox playground.

---

## Key Files

| File | Role |
|---|---|
| `frontend/src/App.tsx` | Root component — mode routing, auth guard, OAuth redirect handling |
| `frontend/src/main.tsx` | React 18 entry point, Zustand store hydration |
| `frontend/vite.config.ts` | Vite dev server config, proxy rules, path aliases |
| `frontend/tailwind.config.ts` | Tailwind CSS theme and plugin setup |
| `frontend/package.json` | Dependencies and build scripts |
| `frontend/.eslintrc.cjs` | ESLint config (enforced at zero warnings) |

---

## Tech Stack

| Technology | Version | Role |
|---|---|---|
| React | 18.3 | UI framework |
| TypeScript | 5.2 | Type safety |
| Vite | 5.3 | Dev server and bundler |
| Zustand | 4.5 | Global state + localStorage persistence |
| Radix UI | 1.1 | Accessible headless component primitives |
| Tailwind CSS | 3.4 | Utility-first styling |
| Framer Motion | 12.40 | Animations (sidebar, panel transitions) |
| React Markdown | 9.0 | Markdown rendering with math (KaTeX) and GFM |
| react-syntax-highlighter | 16.1 | Code block syntax highlighting |
| Monaco Editor | 0.50 | Embedded code editor (Sandbox mode) |
| PDF.js | 6.0 | PDF preview with Web Worker |
| Recharts | 3.8 | Chart rendering for `render_chart` tool output |
| TanStack Query | 5.45 | Server-state caching (minimal use) |

---

## Directory Structure

```
frontend/src/
├── App.tsx                          # Root — mode switching, OAuth redirect
├── main.tsx                         # Entry point
├── index.css                        # Global Tailwind base styles
├── api/
│   └── client.ts                    # All REST + SSE API calls
├── components/
│   ├── auth/
│   │   ├── LoginDialog.tsx
│   │   └── DeleteAccountDialog.tsx
│   ├── chat/
│   │   ├── ChatWindow.tsx           # Main chat UI (largest component)
│   │   └── PlanPreviewCard.tsx
│   ├── code/
│   │   └── CodeWindow.tsx
│   ├── cowork/
│   │   ├── CoworkWindow.tsx
│   │   └── DesktopSessionWindow.tsx # Shared shell for cowork + code modes
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── SettingsDialog.tsx
│   │   ├── SkillsPanel.tsx
│   │   ├── ToolsRegistryPanel.tsx
│   │   ├── MemoryPanel.tsx
│   │   ├── MetricsPanel.tsx
│   │   ├── FileViewerModal.tsx
│   │   ├── PdfPageThumbnail.tsx
│   │   └── ThemeToggle.tsx
│   ├── sandbox/
│   │   └── SandboxWindow.tsx
│   └── ui/
│       └── Badge.tsx
├── config/
│   └── codeThemes.ts
├── i18n/
│   ├── index.ts                    # translate / translateN + useT() hook
│   ├── en.ts                       # English dictionary (source of truth)
│   └── zh.ts                       # Simplified Chinese (typed against en)
├── hooks/
│   ├── useStream.ts                 # Core streaming hook
│   ├── useChatHistory.ts
│   ├── usePlanExecution.ts
│   ├── useScheduledTasks.ts         # Scheduled-task CRUD
│   ├── useAudioRecorder.ts          # Mic capture → transcription
│   ├── useSpeech.ts                  # Text-to-speech (read aloud)
│   └── useMediaQuery.ts             # useIsNarrow() — mobile layout switch
├── store/
│   └── index.ts                     # Zustand AppState
├── types/
│   └── index.ts                     # TypeScript interfaces
└── lib/
    ├── utils.ts                     # generateId, cn (className merge)
    └── platform.ts                  # IS_TAURI / IS_MOBILE / IS_DESKTOP
```

---

## Mode Routing

There is no React Router. Mode switching is purely state-driven via the `mode` field in the Zustand store.

```tsx
// App.tsx
const mode = useAppStore((s) => s.mode)

return (
  <div>
    <Sidebar />
    {mode === 'chat'    && <ChatWindow />}
    {mode === 'cowork'  && <CoworkWindow />}
    {mode === 'code'    && <CodeWindow />}
    {mode === 'sandbox' && <SandboxWindow />}
  </div>
)
```

`CoworkWindow` and `CodeWindow` both render `<DesktopSessionWindow mode="cowork|code" />` — a shared shell for text-input → SSE stream modes that don't need the full `ChatWindow` message history UI.

---

## Tauri Detection

The frontend detects whether it's running inside Tauri at startup:

```typescript
// api/client.ts
const IS_TAURI = Boolean((window as any).__TAURI_INTERNALS__)
export const BASE = IS_TAURI ? 'http://localhost:8000/api' : '/api'
```

In Vite dev mode, `/api` proxies to `http://localhost:8000` (configured in `vite.config.ts`). In Tauri production, the full URL is used because there's no Vite proxy.

---

## OAuth Redirect Handling

On app mount (`App.tsx`), the component checks for OAuth redirect signals:

1. **`?oauth_pending=<token>`** in the URL query string → new OAuth user needs to choose a username → open `LoginDialog` in "complete-oauth" mode
2. **`#token=<jwt>`** in the URL hash → existing OAuth user re-authenticated → store JWT, clear hash

---

## Theme System

`uiTheme` in the Zustand store (`"light"` | `"dark"`) is applied as a class on `<html>`:

```typescript
useEffect(() => {
  document.documentElement.classList.toggle('dark', uiTheme === 'dark')
}, [uiTheme])
```

Tailwind's `darkMode: 'class'` config enables CSS-variable-driven dark mode for all components.

---

## Internationalization

The UI is fully localized (English default, Simplified Chinese). A `language` field in the Zustand store drives a lightweight, provider-free `useT()` hook; switching language re-renders the whole app instantly. See **`doc/frontend/i18n.md`** for the dictionary structure, the compile-time key-parity guarantee, and how to add strings or languages.

---

## Mobile & Platform

The same SPA runs as an **Android / iOS** app (Tauri v2) as well as the macOS desktop app. `src/lib/platform.ts` exposes `IS_TAURI`, `IS_MOBILE`, and `IS_DESKTOP` (`IS_TAURI && !IS_MOBILE`, with an iPadOS desktop-UA fallback). Desktop-only features (Cowork/Code modes, filesystem, `desktop_control`) are gated on `IS_DESKTOP`, so phones are Chat-first.

- **Configurable backend URL** — the mobile app is a thin client; `client.ts` `apiBase()` reads a user-set backend URL from the store (Settings → AI & Chat → Backend URL), since `localhost` on a phone is the device itself.
- **Responsive layout** — `useIsNarrow()` (`useMediaQuery`, forced true on real mobile) switches to a slide-in drawer sidebar, full-screen scrollable Settings, and safe-area insets (portrait + landscape).

See **`doc/android.md`** for the Android/iOS build + run guide.

---

## Voice (speech-to-text + text-to-speech)

- **Speech-to-text** — a mic button in every composer records audio (`useAudioRecorder`), posts it to `POST /api/transcribe`, and inserts the returned text. Transcription runs locally on the backend via Whisper (see `doc/backend/transcription.md`).
- **Text-to-speech** — a "read aloud" button on assistant messages uses `useSpeech` over the browser `SpeechSynthesis` API (OS voices, en/zh auto-selected). No backend involved.

---

## Build and Dev

```bash
# Dev server (proxies /api → localhost:8000)
cd frontend && npm run dev

# Production build → frontend/dist/
cd frontend && npm run build

# Lint
cd frontend && npx eslint . --ext ts,tsx --max-warnings 0

# Format
cd frontend && npx prettier --write "src/**/*.{ts,tsx,css}"
```
