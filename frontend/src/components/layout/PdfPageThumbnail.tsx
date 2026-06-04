import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { fetchRagSourceContent } from '@/api/client'

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

interface Props {
  source: string
  containerWidth: number
  containerHeight: number
}

export function PdfPageThumbnail({ source, containerWidth, containerHeight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let blobUrl: string | null = null

    ;(async () => {
      try {
        blobUrl = await fetchRagSourceContent(source, true)
        if (cancelled) return

        const loadingTask = pdfjsLib.getDocument({ url: blobUrl })
        const pdf = await loadingTask.promise
        if (cancelled) return

        const page = await pdf.getPage(1)
        if (cancelled) return

        const baseViewport = page.getViewport({ scale: 1 })
        const scale = Math.min(
          containerWidth / baseViewport.width,
          containerHeight / baseViewport.height,
        )
        const viewport = page.getViewport({ scale })

        const canvas = canvasRef.current
        if (!canvas || cancelled) return

        const dpr = window.devicePixelRatio || 1
        canvas.width = viewport.width * dpr
        canvas.height = viewport.height * dpr
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.scale(dpr, dpr)
        await page.render({ canvasContext: ctx, viewport }).promise
        if (!cancelled) setRendered(true)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (blobUrl) URL.revokeObjectURL(blobUrl)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [source, containerWidth, containerHeight])

  if (failed) return <PdfFallback />

  return (
    <>
      {!rendered && <PdfFallback />}
      <canvas
        ref={canvasRef}
        style={{
          display: rendered ? 'block' : 'none',
          maxWidth: '100%',
          maxHeight: '100%',
        }}
      />
    </>
  )
}

function PdfFallback() {
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
      PDF
    </span>
  )
}
