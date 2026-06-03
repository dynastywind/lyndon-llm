import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Eye, EyeOff } from 'lucide-react'
import { checkUsername, login, register, resetPassword, getGoogleAuthUrl, completeOAuthLogin } from '@/api/client'
import { useAppStore } from '@/store'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Non-null when App detected ?oauth_pending=<token> in the URL — auto-enters oauth-username mode. */
  pendingOAuthToken?: string | null
}

export function LoginDialog({ open, onOpenChange, pendingOAuthToken }: Props) {
  const { setUser, bumpSessionVersion } = useAppStore()
  const [mode, setMode] = useState<'login' | 'register' | 'reset' | 'oauth-username'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [resetSuccess, setResetSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [usernameTaken, setUsernameTaken] = useState(false)
  const [checkingUsername, setCheckingUsername] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Reset to login mode (or oauth-username if pending token) whenever the dialog opens
  useEffect(() => {
    if (open) {
      setMode(pendingOAuthToken ? 'oauth-username' : 'login')
      setUsername('')
      setPassword('')
      setConfirm('')
      setError('')
      setResetSuccess(false)
      setUsernameTaken(false)
      setShowPassword(false)
    }
  }, [open, pendingOAuthToken])

  const needsConfirm = mode === 'register' || mode === 'reset'
  const confirmMismatch = needsConfirm && confirm.length > 0 && confirm !== password

  const handleUsernameBlur = async () => {
    if ((mode !== 'register' && mode !== 'oauth-username') || !username.trim()) return
    setCheckingUsername(true)
    try {
      const { available } = await checkUsername(username.trim())
      setUsernameTaken(!available)
    } catch {
      // server will catch on submit
    } finally {
      setCheckingUsername(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) return
    if (mode !== 'oauth-username' && !password) return
    if (mode === 'register' && usernameTaken) return
    if (needsConfirm && password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setError('')
    setLoading(true)
    try {
      if (mode === 'oauth-username') {
        const res = await completeOAuthLogin(pendingOAuthToken!, username.trim())
        setUser({ id: res.id, username: res.username, email: res.email ?? null, token: res.access_token })
        bumpSessionVersion()
        onOpenChange(false)
        return
      }
      if (mode === 'reset') {
        await resetPassword(username.trim(), password)
        setResetSuccess(true)
        setPassword('')
        setConfirm('')
        setShowPassword(false)
        setMode('login')
        return
      }
      const fn = mode === 'login' ? login : register
      const res = await fn(username.trim(), password)
      setUser({ id: res.id, username: res.username, email: res.email ?? null, token: res.access_token })
      bumpSessionVersion()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      const { url } = await getGoogleAuthUrl()
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login unavailable')
    }
  }

  const switchMode = (next: 'login' | 'register' | 'reset') => {
    setMode(next)
    setError('')
    setResetSuccess(false)
    setUsernameTaken(false)
    setPassword('')
    setConfirm('')
    setShowPassword(false)
  }

  const usernameInvalid = (mode === 'register' || mode === 'oauth-username') && usernameTaken
  const submitDisabled =
    loading ||
    !username.trim() ||
    (mode !== 'oauth-username' && !password) ||
    usernameInvalid ||
    (needsConfirm && (!confirm || confirmMismatch))

  const inputStyle = (invalid = false): React.CSSProperties => ({
    background: 'var(--lv-bg)',
    border: `1px solid ${invalid ? 'var(--lv-error, #e55)' : 'var(--lv-border)'}`,
    borderRadius: 6,
    padding: '8px 10px',
    color: 'var(--lv-ink)',
    fontSize: 14,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  })

  const linkBtn = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        color: 'var(--lv-accent)',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  )

  const titleMap = {
    login: 'Sign in',
    register: 'Create account',
    reset: 'Reset password',
    'oauth-username': 'Choose a username',
  }
  const submitMap = {
    login: 'Sign in',
    register: 'Create account',
    reset: 'Reset password',
    'oauth-username': 'Continue',
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{ position: 'fixed', inset: 0, background: 'var(--lv-bg)', zIndex: 50 }}
        />
        <Dialog.Content
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 360,
            background: 'var(--lv-surface)',
            border: '1px solid var(--lv-border)',
            borderRadius: 12,
            padding: '28px 28px 24px',
            zIndex: 51,
            outline: 'none',
          }}
        >
          <Dialog.Title
            style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 600, color: 'var(--lv-ink)' }}
          >
            {titleMap[mode]}
          </Dialog.Title>

          {/* oauth-username subtitle */}
          {mode === 'oauth-username' && (
            <p style={{ margin: '-12px 0 16px', fontSize: 13, color: 'var(--lv-ink-muted)' }}>
              Your Google account isn't linked to a user yet. Choose a username to continue.
            </p>
          )}

          {/* Success banner after password reset */}
          {resetSuccess && (
            <p
              style={{
                margin: '0 0 14px',
                fontSize: 12,
                color: 'var(--lv-accent)',
                padding: '8px 10px',
                background: 'color-mix(in srgb, var(--lv-accent) 12%, transparent)',
                borderRadius: 6,
              }}
            >
              Password updated. Please sign in with your new password.
            </p>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Username */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--lv-ink-muted)', fontWeight: 500 }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setUsernameTaken(false) }}
                onBlur={handleUsernameBlur}
                autoFocus
                autoComplete="username"
                style={inputStyle(usernameInvalid)}
              />
              {checkingUsername && (
                <span style={{ fontSize: 11, color: 'var(--lv-ink-muted)' }}>Checking…</span>
              )}
              {usernameInvalid && (
                <span style={{ fontSize: 11, color: 'var(--lv-error, #e55)' }}>
                  Username already taken
                </span>
              )}
            </div>

            {/* Password — hidden in oauth-username mode */}
            {mode !== 'oauth-username' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: 12, color: 'var(--lv-ink-muted)', fontWeight: 500 }}>
                    {mode === 'reset' ? 'New password' : 'Password'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: 'var(--lv-ink-muted)',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  style={inputStyle()}
                />
                {/* Forgot password — login mode only */}
                {mode === 'login' && (
                  <div style={{ textAlign: 'right' }}>
                    {linkBtn('Forgot password?', () => switchMode('reset'))}
                  </div>
                )}
              </div>
            )}

            {/* Confirm password — register and reset modes */}
            {needsConfirm && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--lv-ink-muted)', fontWeight: 500 }}>
                  Confirm password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  style={inputStyle(confirmMismatch)}
                />
                {confirmMismatch && (
                  <span style={{ fontSize: 11, color: 'var(--lv-error, #e55)' }}>
                    Passwords do not match
                  </span>
                )}
              </div>
            )}

            {error && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--lv-error, #e55)', padding: '6px 0' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitDisabled}
              style={{
                marginTop: 4,
                padding: '9px 0',
                background: 'var(--lv-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: loading ? 'wait' : 'pointer',
                opacity: submitDisabled ? 0.6 : 1,
              }}
            >
              {loading ? 'Please wait…' : submitMap[mode]}
            </button>

            {/* Google login button — shown in login and register modes */}
            {(mode === 'login' || mode === 'register') && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                  <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--lv-border)' }} />
                  <span style={{ fontSize: 11, color: 'var(--lv-ink-muted)' }}>or</span>
                  <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--lv-border)' }} />
                </div>
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  style={{
                    padding: '9px 0',
                    background: 'transparent',
                    color: 'var(--lv-ink)',
                    border: '1px solid var(--lv-border)',
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  {/* Google "G" SVG */}
                  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    <path fill="none" d="M0 0h48v48H0z"/>
                  </svg>
                  Continue with Google
                </button>
              </>
            )}
          </form>

          {/* Footer navigation */}
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--lv-ink-muted)', textAlign: 'center' }}>
            {mode === 'login' && (
              <p style={{ margin: 0 }}>
                {"Don't have an account? "}
                {linkBtn('Register', () => switchMode('register'))}
              </p>
            )}
            {mode === 'register' && (
              <p style={{ margin: 0 }}>
                {'Already have an account? '}
                {linkBtn('Sign in', () => switchMode('login'))}
              </p>
            )}
            {mode === 'reset' && (
              <p style={{ margin: 0 }}>
                {'Remember it? '}
                {linkBtn('Back to sign in', () => switchMode('login'))}
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
