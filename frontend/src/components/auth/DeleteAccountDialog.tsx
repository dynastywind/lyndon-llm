import { useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { deleteAccount } from '@/api/client'
import { useAppStore } from '@/store'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteAccountDialog({ open, onOpenChange }: Props) {
  const { logout } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    setLoading(true)
    setError('')
    try {
      await deleteAccount()
      logout()
      onOpenChange(false)
    } catch {
      setError('Failed to delete account. Please try again.')
      setLoading(false)
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 60,
          }}
        />
        <AlertDialog.Content
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 380,
            background: 'var(--lv-surface)',
            border: '1px solid var(--lv-border)',
            borderRadius: 12,
            padding: '28px 28px 24px',
            zIndex: 61,
            outline: 'none',
          }}
        >
          <AlertDialog.Title
            style={{
              margin: '0 0 10px',
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--lv-ink)',
            }}
          >
            Delete account?
          </AlertDialog.Title>
          <AlertDialog.Description
            style={{
              margin: '0 0 20px',
              fontSize: 13,
              color: 'var(--lv-ink-muted)',
              lineHeight: 1.5,
            }}
          >
            This will permanently delete your account and all associated data — MCP servers,
            memories, knowledge base files, and session history. This action cannot be undone.
          </AlertDialog.Description>

          {error && (
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--lv-error, #e55)' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <AlertDialog.Cancel asChild>
              <button
                style={{
                  padding: '8px 16px',
                  background: 'var(--lv-bg)',
                  border: '1px solid var(--lv-border)',
                  borderRadius: 6,
                  color: 'var(--lv-ink)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <button
              onClick={handleDelete}
              disabled={loading}
              style={{
                padding: '8px 16px',
                background: '#dc2626',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                fontSize: 13,
                fontWeight: 500,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
