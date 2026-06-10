import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

export default function PdfCanvas({ data }: { data: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1) // 1 = 适应宽度

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    // data.slice(0) clones the buffer (pdf.js may transfer/detach it)
    const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) })
    loadingTask.promise
      .then(async (doc) => {
        // 清晰渲染：CSS 尺寸 = 适应宽度 × zoom，物理像素再 ×devicePixelRatio。
        // 缩放走真实重渲染（非 CSS 拉伸），任意倍率下保持锐利。
        const fitWidth = container.clientWidth || 800
        const dpr = window.devicePixelRatio || 1
        for (let i = 1; i <= doc.numPages && !cancelled; i++) {
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (fitWidth / base.width) * zoom })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.cssText =
            `width:${Math.floor(viewport.width)}px;display:block;margin:0 auto 8px;box-shadow:0 1px 4px rgba(0,0,0,0.2)`
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          container.appendChild(canvas)
          await page.render({
            canvasContext: ctx, viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise
        }
      })
      .catch((err) => {
        if (!cancelled) container.innerHTML = '<p style="color:crimson;padding:12px">PDF 渲染失败</p>'
        console.error('pdf render error', err)
      })
    return () => { cancelled = true }
  }, [data, zoom])

  const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(z.toFixed(2))))

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button aria-label="缩小" onClick={() => setZoom(z => clamp(z - ZOOM_STEP))} disabled={zoom <= ZOOM_MIN}>−</button>
        <span className="pdf-zoom-pct">{Math.round(zoom * 100)}%</span>
        <button aria-label="放大" onClick={() => setZoom(z => clamp(z + ZOOM_STEP))} disabled={zoom >= ZOOM_MAX}>＋</button>
        <button onClick={() => setZoom(1)} disabled={zoom === 1}>适应宽度</button>
      </div>
      <div ref={containerRef} className="pdf-pages" />
    </div>
  )
}
