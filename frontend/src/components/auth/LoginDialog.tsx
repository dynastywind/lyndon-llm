import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Eye, EyeOff } from 'lucide-react'
import { checkUsername, login, register } from '@/api/client'
import { useAppStore } from '@/store'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LoginDialog({ open, onOpenChange }: Props) {
  const { setUser, bumpSessionVersion } = useAppStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [usernameTaken, setUsernameTaken] = useState(false)
  const [checkingUsername, setCheckingUsername] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Reset to login mode and clear fields whenever the dialog opens
  useEffect(() => {
    if (open) {
      setMode('login')
      setUsername('')
      setPassword('')
      setConfirm('')
      setError('')
      setUsernameTaken(false)
      setShowPassword(false)
    }
  }, [open])

  const confirmMismatch = mode === 'register' && confirm.length > 0 && confirm !== password

  const handleUsernameBlur = async () => {
    if (mode !== 'register' || !username.trim()) return
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
    if (!username.trim() || !password) return
    if (mode === 'register' && usernameTaken) return
    if (mode === 'register' && password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setError('')
    setLoading(true)
    try {
      const fn = mode === 'login' ? login : register
      const res = await fn(username.trim(), password)
      setUser({ id: res.id, username: res.username, token: res.access_token })
      bumpSessionVersion()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const toggleMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'))
    setError('')
    setUsernameTaken(false)
    setConfirm('')
  }

  const usernameInvalid = mode === 'register' && usernameTaken
  const submitDisabled =
    loading ||
    !username.trim() ||
    !password ||
    usernameInvalid ||
    (mode === 'register' && (!confirm || confirmMismatch))

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

  const revealToggle = (
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
  )

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
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </Dialog.Title>

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

            {/* Password — label row has the single reveal toggle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: 12, color: 'var(--lv-ink-muted)', fontWeight: 500 }}>
                  Password
                </label>
                {revealToggle}
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                style={inputStyle()}
              />
            </div>

            {/* Confirm password — register only, shares the same reveal state */}
            {mode === 'register' && (
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
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p style={{ margin: '16px 0 0', fontSize: 12, color: 'var(--lv-ink-muted)', textAlign: 'center' }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={toggleMode}
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
              {mode === 'login' ? 'Register' : 'Sign in'}
            </button>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
