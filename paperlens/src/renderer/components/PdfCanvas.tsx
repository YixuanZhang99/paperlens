import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

export default function PdfCanvas({ data, onAskSelection }: { data: ArrayBuffer; onAskSelection?: (text: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1) // 1 = 适应宽度
  const [sel, setSel] = useState<{ x: number; y: number; text: string } | null>(null)

  useEffect(() => {
    const onSelChange = () => {
      const s = window.getSelection()
      const text = s?.toString().trim() ?? ''
      const root = containerRef.current
      if (!text || !s || s.rangeCount === 0 || !root) { setSel(null); return }
      const anchor = s.anchorNode
      if (!anchor || !root.contains(anchor)) { setSel(null); return }
      const rect = s.getRangeAt(0).getBoundingClientRect()
      const viewer = root.parentElement?.getBoundingClientRect() ?? root.getBoundingClientRect()
      setSel({ x: rect.right - viewer.left, y: rect.bottom - viewer.top, text })
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [])

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
          const cssWidth = Math.floor(viewport.width)

          const wrap = document.createElement('div')
          wrap.className = 'pdf-page-wrap'
          wrap.style.cssText = `position:relative;width:${cssWidth}px;margin:0 auto 8px;`

          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.cssText =
            `width:${cssWidth}px;display:block;box-shadow:0 1px 4px rgba(0,0,0,0.2)`
          const ctx = canvas.getContext('2d')
          if (!ctx) continue

          wrap.appendChild(canvas)
          container.appendChild(wrap)

          await page.render({
            canvasContext: ctx, viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise

          if (!cancelled) {
            // 文本层（CSS 尺寸 viewport，--scale-factor 对齐）
            try {
              const textDiv = document.createElement('div')
              textDiv.className = 'textLayer'
              textDiv.style.setProperty('--scale-factor', String((fitWidth / base.width) * zoom))
              wrap.appendChild(textDiv)
              const tl = new TextLayer({
                textContentSource: await page.getTextContent(),
                container: textDiv,
                viewport,
              })
              await tl.render()
            } catch (e) {
              console.error('text layer error', e)
            }
          }
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
      {sel && onAskSelection && (
        <button
          className="ask-selection-btn"
          style={{ position: 'absolute', left: sel.x, top: sel.y, zIndex: 5 }}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { onAskSelection(sel.text); setSel(null) }}
        >✨ 问这段</button>
      )}
    </div>
  )
}
