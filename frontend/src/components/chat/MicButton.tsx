import { Loader2, Mic, Square } from 'lucide-react'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useT } from '@/i18n'

/**
 * Circular mic button for the message composer. Records via the microphone and
 * inserts the transcription through `onTranscript`. Styled to match the
 * attachment button (28×28, gold accent when active).
 */
export function MicButton({
  onTranscript,
  disabled = false,
}: {
  onTranscript: (text: string) => void
  disabled?: boolean
}) {
  const { t } = useT()
  const { recording, transcribing, error, toggle } = useAudioRecorder(onTranscript)

  const active = recording || transcribing
  const title = error ?? (recording ? t('voice.stop') : t('voice.record'))

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || transcribing}
      title={title}
      aria-label={title}
      aria-pressed={recording}
      style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        borderRadius: '50%',
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
        <Loader2 size={14} className="animate-spin" />
      ) : recording ? (
        <Square size={12} fill="currentColor" />
      ) : (
        <Mic size={14} />
      )}
    </button>
  )
}
