import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { findAllMatchRanges } from '../lib/quote-match'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

export default function PdfCanvas({ data, onAskSelection }: { data: ArrayBuffer; onAskSelection?: (text: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1) // 1 = 适应宽度
  const [sel, setSel] = useState<{ x: number; y: number; text: string } | null>(null)
  // 页内搜索（Ctrl/Cmd+F）
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  // 每个命中 = 该匹配覆盖的一组 span（跨 span 匹配可能不止一个）
  const [hits, setHits] = useState<HTMLElement[][]>([])
  const [cur, setCur] = useState(0)
  const [renderTick, setRenderTick] = useState(0) // textLayer 重渲染后 +1，触发重匹配

  // Cmd/Ctrl+F：PDF tab 打开时聚焦搜索框
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && document.querySelector('.pdf-viewer')) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // query 或 textLayer 变化 → 清旧高亮、重匹配（逐页拼接全文，跨 span、归一化子串）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.querySelectorAll('span.search-hit, span.search-hit-active').forEach(el =>
      el.classList.remove('search-hit', 'search-hit-active'))
    const matches: HTMLElement[][] = []
    // 逐页（每个 .textLayer 一页）匹配，避免一处匹配跨页拼接
    container.querySelectorAll<HTMLElement>('.textLayer').forEach(layer => {
      const spans = [...layer.querySelectorAll<HTMLElement>('span')]
      if (spans.length === 0) return
      for (const r of findAllMatchRanges(spans.map(s => s.textContent ?? ''), query)) {
        const group = spans.slice(r.start, r.end + 1)
        group.forEach(s => s.classList.add('search-hit'))
        matches.push(group)
      }
    })
    setHits(matches)
    setCur(0)
  }, [query, renderTick])

  // 当前命中：整组 active 类 + 滚动首 span 到视野中央
  useEffect(() => {
    if (hits.length === 0) return
    hits.flat().forEach(h => h.classList.remove('search-hit-active'))
    const group = hits[Math.min(cur, hits.length - 1)]
    group.forEach(s => s.classList.add('search-hit-active'))
    group[0]?.scrollIntoView({ block: 'center' })
  }, [hits, cur])

  const moveCur = (delta: number) => {
    if (hits.length === 0) return
    setCur(c => (c + delta + hits.length) % hits.length)
  }

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setQuery('')
      e.currentTarget.blur()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      moveCur(e.shiftKey ? -1 : 1)
    }
  }

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
        // textLayer 全部渲染完成 → 若有搜索词则对新 DOM 重新匹配
        if (!cancelled) setRenderTick(t => t + 1)
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
        <input
          ref={searchRef}
          className="pdf-search-input"
          placeholder="搜索…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        <span className="pdf-search-count">{hits.length > 0 ? `${cur + 1}/${hits.length}` : '0/0'}</span>
        <button aria-label="上一个" onClick={() => moveCur(-1)} disabled={hits.length === 0}>‹</button>
        <button aria-label="下一个" onClick={() => moveCur(1)} disabled={hits.length === 0}>›</button>
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
