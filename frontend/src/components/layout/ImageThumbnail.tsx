import { useEffect, useRef, useState } from 'react'
import { fetchRagSourceContent } from '@/api/client'

interface Props {
  source: string
  containerWidth: number
  containerHeight: number
}

export function ImageThumbnail({ source, containerWidth, containerHeight }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const blobRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetchRagSourceContent(source, true)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        blobRef.current = url
        setBlobUrl(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current)
        blobRef.current = null
      }
    }
  }, [source])

  if (failed || !blobUrl) return <ImageFallback />

  return (
    <img
      src={blobUrl}
      alt=""
      style={{
        maxWidth: containerWidth,
        maxHeight: containerHeight,
        objectFit: 'contain',
      }}
    />
  )
}

function ImageFallback() {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.18em',
        color: 'var(--lv-gold)',
        textTransform: 'uppercase',
      }}
    >
      IMG
    </span>
  )
}
