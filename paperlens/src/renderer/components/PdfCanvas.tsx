import { useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfCanvas({ data }: { data: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    // data.slice(0) clones the buffer (pdf.js may transfer/detach it)
    const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) })
    loadingTask.promise
      .then(async (doc) => {
        // 清晰渲染：CSS 尺寸跟随容器宽，物理像素 ×devicePixelRatio（Retina 不再模糊）
        const containerWidth = container.clientWidth || 800
        const dpr = window.devicePixelRatio || 1
        for (let i = 1; i <= doc.numPages && !cancelled; i++) {
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: containerWidth / base.width })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.cssText = `width:100%;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,0.2)`
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
  }, [data])
  return <div ref={containerRef} style={{ overflow: 'auto' }} />
}
