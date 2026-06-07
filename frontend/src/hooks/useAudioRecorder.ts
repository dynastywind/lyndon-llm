import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeAudio } from '@/api/client'
import { useAppStore } from '@/store'
import { useT } from '@/i18n'

export interface AudioRecorderState {
  recording: boolean
  transcribing: boolean
  error: string | null
  /** Toggle between start and stop. */
  toggle: () => void
}

/**
 * Microphone recording + transcription, shared across composers.
 *
 * `start()` requests mic access and records via MediaRecorder; `stop()`
 * assembles the clip, sends it to the backend Whisper endpoint, and hands the
 * resulting text to `onTranscript`. The current UI language is passed as a
 * transcription hint. The media stream is always torn down when recording ends
 * or the component unmounts.
 */
export function useAudioRecorder(onTranscript: (text: string) => void): AudioRecorderState {
  const language = useAppStore((s) => s.language)
  const { t } = useT()

  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        cleanupStream()
        if (blob.size === 0) return
        setTranscribing(true)
        try {
          const text = await transcribeAudio(blob, language)
          if (text.trim()) onTranscript(text.trim())
        } catch {
          setError(t('voice.failed'))
        } finally {
          setTranscribing(false)
        }
      }

      recorder.start()
      setRecording(true)
    } catch (err) {
      cleanupStream()
      setRecording(false)
      setError(
        (err as DOMException)?.name === 'NotAllowedError' ? t('voice.denied') : t('voice.failed'),
      )
    }
  }, [language, onTranscript, cleanupStream, t])

  const stop = useCallback(() => {
    setRecording(false)
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop() // fires onstop → transcription
    } else {
      cleanupStream()
    }
  }, [cleanupStream])

  const toggle = useCallback(() => {
    if (recording) stop()
    else void start()
  }, [recording, start, stop])

  // Tear down the stream if the component unmounts mid-recording.
  useEffect(() => cleanupStream, [cleanupStream])

  return { recording, transcribing, error, toggle }
}
