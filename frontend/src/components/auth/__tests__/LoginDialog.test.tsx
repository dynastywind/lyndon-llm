/**
 * LoginDialog component tests — form rendering, validation, submit flow,
 * mode switching, and OAuth username path.
 *
 * The component labels are siblings (not parents) of their inputs so they
 * lack htmlFor/id associations. Queries use role + input type selectors
 * rather than getByLabelText.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { LoginDialog } from '../LoginDialog'
import { useAppStore } from '@/store'

vi.mock('@/api/client', () => ({
  login: vi.fn(),
  register: vi.fn(),
  resetPassword: vi.fn(),
  checkUsername: vi.fn(),
  getGoogleAuthUrl: vi.fn(),
  completeOAuthLogin: vi.fn(),
}))

import { login, register, resetPassword, checkUsername, completeOAuthLogin } from '@/api/client'

// ── helpers ───────────────────────────────────────────────────────────────────

function fakeUser() {
  return { id: 'u1', username: 'alice', email: null, access_token: 'tok' }
}

function renderDialog(props: Partial<React.ComponentProps<typeof LoginDialog>> = {}) {
  const onOpenChange = vi.fn()
  const { container } = render(
    <LoginDialog open={true} onOpenChange={onOpenChange} pendingOAuthToken={null} {...props} />,
  )
  // Radix Dialog portals content to document.body — query the whole document.
  const usernameInput = () => document.querySelector('input[type="text"]') as HTMLInputElement
  const passwordInputs = () =>
    Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
  const submitBtn = () =>
    Array.from(document.querySelectorAll('button')).find(
      (b) => (b as HTMLButtonElement).type === 'submit',
    ) as HTMLButtonElement
  return { onOpenChange, container, usernameInput, passwordInputs, submitBtn }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ user: null })
})

// ── rendering ─────────────────────────────────────────────────────────────────

describe('LoginDialog — rendering', () => {
  it('shows the Sign in heading by default', () => {
    renderDialog()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })

  it('renders username and password inputs', () => {
    const { usernameInput, passwordInputs } = renderDialog()
    expect(usernameInput()).toBeTruthy()
    expect(passwordInputs()).toHaveLength(1)
  })

  it('does not render when open=false', () => {
    render(<LoginDialog open={false} onOpenChange={vi.fn()} />)
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
  })

  it('shows "Choose a username" heading when pendingOAuthToken is set', () => {
    renderDialog({ pendingOAuthToken: 'oauth-token-abc' })
    expect(screen.getByRole('heading', { name: 'Choose a username' })).toBeTruthy()
  })

  it('hides the password input in oauth-username mode', () => {
    const { passwordInputs } = renderDialog({ pendingOAuthToken: 'tok' })
    expect(passwordInputs()).toHaveLength(0)
  })
})

// ── submit button disabled state ───────────────────────────────────────────────

describe('LoginDialog — submit disabled state', () => {
  it('submit is disabled when username is empty', () => {
    const { submitBtn } = renderDialog()
    expect(submitBtn().disabled).toBe(true)
  })

  it('submit is disabled when password is empty', () => {
    const { usernameInput, submitBtn } = renderDialog()
    fireEvent.change(usernameInput(), { target: { value: 'alice' } })
    expect(submitBtn().disabled).toBe(true)
  })

  it('submit is enabled when both username and password are filled', () => {
    const { usernameInput, passwordInputs, submitBtn } = renderDialog()
    fireEvent.change(usernameInput(), { target: { value: 'alice' } })
    fireEvent.change(passwordInputs()[0], { target: { value: 'secret' } })
    expect(submitBtn().disabled).toBe(false)
  })
})

// ── mode switching ─────────────────────────────────────────────────────────────

describe('LoginDialog — mode switching', () => {
  it('switches to Register mode and shows Create account heading', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeTruthy()
  })

  it('shows a Confirm password input in register mode', () => {
    const { passwordInputs } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    expect(passwordInputs()).toHaveLength(2)
  })

  it('switches to reset mode via Forgot password link', () => {
    const { usernameInput } = renderDialog()
    fireEvent.change(usernameInput(), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(screen.getByRole('heading', { name: 'Reset password' })).toBeTruthy()
  })

  it('can navigate back from reset to sign in', () => {
    const { usernameInput } = renderDialog()
    fireEvent.change(usernameInput(), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })
})

// ── login flow ─────────────────────────────────────────────────────────────────

describe('LoginDialog — login flow', () => {
  it('calls login() with trimmed credentials on submit', async () => {
    vi.mocked(login).mockResolvedValue(fakeUser())
    const { usernameInput, passwordInputs, submitBtn, onOpenChange } = renderDialog()

    fireEvent.change(usernameInput(), { target: { value: '  alice  ' } })
    fireEvent.change(passwordInputs()[0], { target: { value: 'password123' } })
    fireEvent.click(submitBtn())

    await waitFor(() => expect(login).toHaveBeenCalledWith('alice', 'password123'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('sets user in the store after successful login', async () => {
    vi.mocked(login).mockResolvedValue(fakeUser())
    const { usernameInput, passwordInputs, submitBtn } = renderDialog()

    fireEvent.change(usernameInput(), { target: { value: 'alice' } })
    fireEvent.change(passwordInputs()[0], { target: { value: 'pass' } })
    fireEvent.click(submitBtn())

    await waitFor(() => expect(useAppStore.getState().user?.username).toBe('alice'))
  })

  it('shows error message on failed login', async () => {
    vi.mocked(login).mockRejectedValue(new Error('Invalid credentials'))
    const { usernameInput, passwordInputs, submitBtn } = renderDialog()

    fireEvent.change(usernameInput(), { target: { value: 'alice' } })
    fireEvent.change(passwordInputs()[0], { target: { value: 'wrong' } })
    fireEvent.click(submitBtn())

    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeTruthy())
  })
})

// ── register flow ──────────────────────────────────────────────────────────────

describe('LoginDialog — register flow', () => {
  it('calls register() when in register mode', async () => {
    vi.mocked(register).mockResolvedValue(fakeUser())
    vi.mocked(checkUsername).mockResolvedValue({ available: true })
    const { usernameInput, passwordInputs, submitBtn } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    fireEvent.change(usernameInput(), { target: { value: 'newuser' } })
    fireEvent.change(passwordInputs()[0], { target: { value: 'mypassword' } })
    fireEvent.change(passwordInputs()[1], { target: { value: 'mypassword' } })
    fireEvent.click(submitBtn())

    await waitFor(() => expect(register).toHaveBeenCalledWith('newuser', 'mypassword'))
  })

  it('shows mismatch error when passwords do not match', () => {
    const { usernameInput, passwordInputs, submitBtn } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    fireEvent.change(usernameInput(), { target: { value: 'bob' } })
    fireEvent.change(passwordInputs()[0], { target: { value: 'abc' } })
    fireEvent.change(passwordInputs()[1], { target: { value: 'xyz' } })

    expect(screen.getByText('Passwords do not match')).toBeTruthy()
    expect(submitBtn().disabled).toBe(true)
  })
})

// ── reset password flow ────────────────────────────────────────────────────────

describe('LoginDialog — reset password flow', () => {
  it('calls resetPassword() and returns to sign-in heading on success', async () => {
    vi.mocked(resetPassword).mockResolvedValue(undefined)
    const { usernameInput, passwordInputs, submitBtn } = renderDialog()

    fireEvent.change(usernameInput(), { target: { value: 'alice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))

    // In reset mode there's one password and one confirm field
    fireEvent.change(passwordInputs()[0], { target: { value: 'newpassword' } })
    fireEvent.change(passwordInputs()[1], { target: { value: 'newpassword' } })
    fireEvent.click(submitBtn())

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('alice', 'newpassword'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy())
  })
})

// ── OAuth username flow ────────────────────────────────────────────────────────

describe('LoginDialog — OAuth username flow', () => {
  it('calls completeOAuthLogin with token and chosen username', async () => {
    vi.mocked(completeOAuthLogin).mockResolvedValue(fakeUser())
    const { usernameInput, submitBtn, onOpenChange } = renderDialog({
      pendingOAuthToken: 'oauth-abc',
    })

    fireEvent.change(usernameInput(), { target: { value: 'newname' } })
    fireEvent.click(submitBtn())

    await waitFor(() => expect(completeOAuthLogin).toHaveBeenCalledWith('oauth-abc', 'newname'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

// ── username availability check ────────────────────────────────────────────────

describe('LoginDialog — username availability', () => {
  it('shows "Username already taken" when server reports unavailable', async () => {
    vi.mocked(checkUsername).mockResolvedValue({ available: false })
    const { usernameInput } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))

    fireEvent.change(usernameInput(), { target: { value: 'taken' } })
    await act(async () => fireEvent.blur(usernameInput()))

    await waitFor(() => expect(screen.getByText('Username already taken')).toBeTruthy())
  })
})
