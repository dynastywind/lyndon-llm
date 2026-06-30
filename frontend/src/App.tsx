import { useEffect, useState } from 'react'
import { Menu } from 'lucide-react'
import { useAppStore } from '@/store'
import { useIsNarrow } from '@/hooks/useMediaQuery'
import { checkAvatarExists, getMe } from '@/api/client'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { CoworkWindow } from '@/components/cowork/CoworkWindow'
import { CodeWindow } from '@/components/code/CodeWindow'
import { SandboxWindow } from '@/components/sandbox/SandboxWindow'
import { ProjectsWindow } from '@/components/projects/ProjectsWindow'
import { ProjectDetailWindow } from '@/components/projects/ProjectDetailWindow'

export default function App() {
  const {
    mode,
    sessionId,
    activeView,
    homeVersion,
    uiTheme,
    language,
    setUser,
    setPendingOAuthToken,
    bumpSessionVersion,
    user,
    avatarVersion,
    setAvatarVersion,
    setSystemPrompt,
    setProfession,
  } = useAppStore()

  const isNarrow = useIsNarrow()
  const [navOpen, setNavOpen] = useState(false)

  // Close the mobile drawer whenever the active view/session changes.
  useEffect(() => {
    setNavOpen(false)
  }, [sessionId, activeView, mode, homeVersion])

  // Apply theme class to <html> whenever uiTheme changes
  useEffect(() => {
    const root = document.documentElement
    if (uiTheme === 'light') {
      root.classList.add('light')
      root.classList.remove('dark')
    } else {
      root.classList.remove('light')
      root.classList.add('dark')
    }
  }, [uiTheme])

  // Reflect the chosen language on <html lang> for accessibility / browser hints
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  // Sync avatarVersion with the server whenever a user logs in on this device.
  // avatarVersion is device-local (localStorage), so a different device won't
  // know an avatar was uploaded elsewhere. This effect checks the server and
  // sets avatarVersion = 1 if a file exists and we don't already know about it.
  useEffect(() => {
    if (!user) return
    if (avatarVersion > 0) return // already know we have one
    checkAvatarExists(user.id).then((exists) => {
      if (exists) setAvatarVersion(1)
    })
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load per-user assistant settings (system prompt, profession) from the
  // server whenever the active account changes (login or reload). These are
  // server-scoped — clearing first guarantees one account never momentarily
  // shows another's prompt before the fetch resolves.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setSystemPrompt('')
    setProfession('')
    getMe()
      .then((me) => {
        if (cancelled) return
        setSystemPrompt(me.system_prompt ?? '')
        setProfession(me.profession ?? '')
      })
      .catch(() => {
        /* backend unreachable — leave cleared */
      })
    return () => {
      cancelled = true
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle OAuth redirects on mount
  useEffect(() => {
    // Case 1: new Google user — pending token in query string
    const params = new URLSearchParams(window.location.search)
    const pendingToken = params.get('oauth_pending')
    if (pendingToken) {
      window.history.replaceState({}, '', '/')
      setPendingOAuthToken(pendingToken)
      return
    }

    // Case 2: returning Google user — full JWT in URL hash
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const token = hash.get('token')
    if (token) {
      window.history.replaceState({}, '', '/')
      try {
        // Decode payload without verification (we trust our own backend redirect)
        const payloadB64 = token.split('.')[1]
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
        setUser({
          id: payload.sub,
          username: payload.username,
          email: payload.email ?? null,
          oauth_provider: payload.oauth_provider ?? null,
          token,
        })
        bumpSessionVersion()
      } catch {
        // malformed token — ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const windowContent =
    activeView === 'projectsList' ? (
      <ProjectsWindow />
    ) : activeView === 'projectDetail' ? (
      <ProjectDetailWindow />
    ) : (
      <>
        {/*
          key=sessionId forces a full remount whenever the active session
          changes, resetting all local state (scroll refs, pagination cursors,
          hasMore flags) and re-fetching messages for the correct session.
        */}
        {mode === 'chat' && <ChatWindow key={sessionId ?? `home-${homeVersion}`} />}
        {mode === 'cowork' && <CoworkWindow key={sessionId ?? `home-${homeVersion}`} />}
        {mode === 'code' && <CodeWindow key={sessionId ?? `home-${homeVersion}`} />}
        {mode === 'sandbox' && <SandboxWindow />}
      </>
    )

  // ── Mobile: sidebar becomes a slide-in drawer ──────────────────────────────
  if (isNarrow) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          background: 'var(--lv-bg)',
          color: 'var(--lv-ink)',
          overflow: 'hidden',
        }}
      >
        {/* Top bar with menu toggle */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            paddingTop: 'calc(env(safe-area-inset-top) + 8px)',
            borderBottom: '1px solid var(--lv-rule)',
            flexShrink: 0,
            background: 'var(--lv-bg)',
          }}
        >
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Menu"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              background: 'none',
              border: 'none',
              color: 'var(--lv-ink)',
              cursor: 'pointer',
            }}
          >
            <Menu size={20} />
          </button>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 17,
              color: 'var(--lv-ink)',
            }}
          >
            LyndonLLM
          </span>
        </header>

        <main
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {windowContent}
        </main>

        {/* Drawer + backdrop */}
        {navOpen && (
          <div
            onClick={() => setNavOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 60 }}
          />
        )}
        <div
          style={{
            position: 'fixed',
            top: 0,
            bottom: 0,
            left: 0,
            width: 'min(86vw, 320px)',
            zIndex: 70,
            transform: navOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.22s var(--ease-snap)',
            boxShadow: navOpen ? '0 0 40px rgba(0,0,0,0.6)' : 'none',
          }}
        >
          <Sidebar mobile onNavigate={() => setNavOpen(false)} />
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: 'var(--lv-bg)',
        color: 'var(--lv-ink)',
        overflow: 'hidden',
      }}
    >
      <Sidebar />
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {windowContent}
      </main>
    </div>
  )
}
