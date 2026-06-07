import { Loader2, Mic, Square } from 'lucide-react'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useT } from '@/i18n'

/**
 * Mic button for the message composer. Records via the microphone and inserts
 * the transcription through `onTranscript`.
 *
 * - `round` (default) — 28×28 circle, matches the attachment button.
 * - `square` — 40×40 rounded rect, matches the send button when placed beside it.
 */
export function MicButton({
  onTranscript,
  disabled = false,
  variant = 'round',
}: {
  onTranscript: (text: string) => void
  disabled?: boolean
  variant?: 'round' | 'square'
}) {
  const { t } = useT()
  const { recording, transcribing, error, toggle } = useAudioRecorder(onTranscript)

  const active = recording || transcribing
  const title = error ?? (recording ? t('voice.stop') : t('voice.record'))
  const square = variant === 'square'
  const size = square ? 40 : 28
  const iconSize = square ? 16 : 14

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || transcribing}
      title={title}
      aria-label={title}
      aria-pressed={recording}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: square ? 4 : '50%',
        border: `1px solid ${active ? 'var(--lv-gold)' : 'var(--lv-rule-strong)'}`,
        background: 'none',
        cursor: disabled || transcribing ? 'default' : 'pointer',
        color: active ? 'var(--lv-gold)' : 'var(--lv-mute)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color 0.15s, color 0.15s',
        animation: recording ? 'lv-mic-pulse 1.2s ease-in-out infinite' : undefined,
      }}
    >
      <style>{`
        @keyframes lv-mic-pulse {
          0%, 100% { opacity: 1 }
          50% { opacity: 0.45 }
        }
      `}</style>
      {transcribing ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : recording ? (
        <Square size={square ? 16 : 12} fill="currentColor" />
      ) : (
        <Mic size={iconSize} />
      )}
    </button>
  )
}
