import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import MonacoEditor from '@monaco-editor/react'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { fetchRagSourceContent, type RagSource } from '@/api/client'
import { useT } from '@/i18n'

// ── Monaco language map ───────────────────────────────────────────────────────

const MONACO_LANG: Record<string, string> = {
  py: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cpp: 'cpp',
  c: 'cpp',
  md: 'markdown',
  mdx: 'markdown',
  txt: 'plaintext',
}

function getExt(path: string): string {
  return (path.split('.').pop() ?? '').toLowerCase()
}

function isPdfPath(path: string): boolean {
  return getExt(path) === 'pdf'
}

// ── FileViewerModal ───────────────────────────────────────────────────────────

interface Props {
  src: RagSource | null
  onClose: () => void
}

export function FileViewerModal({ src, onClose }: Props) {
  const { t } = useT()
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const isPdf = src !== null && isPdfPath(src.path)
  const ext = src ? getExt(src.path) : ''
  const monacoLang = MONACO_LANG[ext] ?? 'plaintext'

  // Load content whenever a new src is opened
  useEffect(() => {
    if (!src) {
      setContent(null)
      setError(null)
      return
    }

    let cancelled = false
    setContent(null)
    setError(null)
    setLoading(true)

    fetchRagSourceContent(src.path, isPdfPath(src.path))
      .then((result) => {
        if (cancelled) return
        if (isPdfPath(src.path)) {
          blobUrlRef.current = result
        }
        setContent(result)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('fileViewer.loadError'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [src, t])

  // Revoke blob URL when src changes away or component unmounts
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [src])

  return (
    <Dialog.Root
      open={src !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            zIndex: 150,
          }}
        />
        <Dialog.Content
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 151,
            width: 'min(960px, 94vw)',
            height: 'min(86vh, 840px)',
            background: 'var(--lv-bg)',
            border: '1px solid var(--lv-rule-strong)',
            boxShadow: '0 32px 100px rgba(0,0,0,0.8)',
            color: 'var(--lv-ink)',
            fontFamily: 'var(--font-sans)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid var(--lv-rule)',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.3em',
                  textTransform: 'uppercase',
                  color: 'var(--lv-gold)',
                }}
              >
                {isPdf ? 'PDF' : ext.toUpperCase()} · {t('fileViewer.viewLabel')}
              </span>
              <Dialog.Title
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 400,
                  color: 'var(--lv-ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {src?.name ?? ''}
              </Dialog.Title>
            </div>

            <button
              onClick={onClose}
              title={t('fileViewer.close')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--lv-mute)',
                padding: 6,
                display: 'flex',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--lv-ink)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--lv-mute)'
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            {loading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  color: 'var(--lv-mute)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                }}
              >
                <Loader2 size={14} className="animate-spin" /> {t('fileViewer.loading')}
              </div>
            )}

            {error && !loading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  color: '#dc2626',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  letterSpacing: '0.08em',
                }}
              >
                <AlertCircle size={14} /> {error}
              </div>
            )}

            {!loading && !error && content !== null && (
              <>
                {isPdf ? (
                  <embed
                    src={content}
                    type="application/pdf"
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                ) : (
                  <MonacoEditor
                    height="100%"
                    language={monacoLang}
                    value={content}
                    theme="vs-dark"
                    options={{
                      readOnly: true,
                      fontSize: 13,
                      lineHeight: 1.6,
                      fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      renderLineHighlight: 'line',
                      padding: { top: 16, bottom: 16 },
                      wordWrap: 'on',
                      lineNumbers: 'on',
                      glyphMargin: false,
                      folding: true,
                      cursorStyle: 'line',
                      scrollbar: {
                        verticalScrollbarSize: 6,
                        horizontalScrollbarSize: 6,
                      },
                    }}
                  />
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
