import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { checkAvatarExists } from '@/api/client'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { CoworkWindow } from '@/components/cowork/CoworkWindow'
import { CodeWindow } from '@/components/code/CodeWindow'
import { SandboxWindow } from '@/components/sandbox/SandboxWindow'

export default function App() {
  const {
    mode,
    sessionId,
    uiTheme,
    setUser,
    setPendingOAuthToken,
    bumpSessionVersion,
    user,
    avatarVersion,
    setAvatarVersion,
  } = useAppStore()

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
        {/*
          key=sessionId forces a full remount whenever the active session
          changes.  This guarantees all local state (scroll refs, pagination
          cursors, hasMore flags) is reset to its initial value and that
          loadInitial always fetches messages for the correct session.
          React 18 batches the setSessionId + addMessage calls from the lazy
          creation path, so the remounted component's effect correctly sees
          messages.length > 0 and skips the unnecessary DB fetch.
        */}
        {mode === 'chat' && <ChatWindow key={sessionId ?? '__new__'} />}
        {mode === 'cowork' && <CoworkWindow key={sessionId ?? '__new__'} />}
        {mode === 'code' && <CodeWindow key={sessionId ?? '__new__'} />}
        {mode === 'sandbox' && <SandboxWindow />}
      </main>
    </div>
  )
}
