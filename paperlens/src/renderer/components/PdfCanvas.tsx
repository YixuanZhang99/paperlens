import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { findAllMatchRanges } from '../lib/quote-match'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(z.toFixed(2))))

export default function PdfCanvas({ data, onAskSelection }: { data: ArrayBuffer; onAskSelection?: (text: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const [docVersion, setDocVersion] = useState(0) // 文档加载完成后 +1，触发页面渲染
  const [zoom, setZoom] = useState(1) // 1 = 适应宽度
  const [sel, setSel] = useState<{ x: number; y: number; text: string } | null>(null)
  // 页内搜索（Ctrl/Cmd+F）
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  // 每个命中 = 该匹配覆盖的一组 span（跨 span 匹配可能不止一个）
  const [hits, setHits] = useState<HTMLElement[][]>([])
  const [cur, setCur] = useState(0)
  const [renderTick, setRenderTick] = useState(0) // textLayer 重渲染后 +1，触发重匹配

  // Cmd/Ctrl+F：聚焦搜索框；Cmd/Ctrl + +/-/0：缩放（仅 PDF tab 打开时）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !document.querySelector('.pdf-viewer')) return
      if (e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setZoom(z => clampZoom(z + ZOOM_STEP))
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setZoom(z => clampZoom(z - ZOOM_STEP))
      } else if (e.key === '0') {
        e.preventDefault()
        setZoom(1)
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

  // 文档只加载/解析一次（缩放时不再重新 getDocument，避免捏合卡顿）
  useEffect(() => {
    let cancelled = false
    docRef.current = null
    // data.slice(0) clones the buffer (pdf.js may transfer/detach it)
    const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) })
    loadingTask.promise
      .then((doc) => {
        if (cancelled) { void doc.destroy(); return }
        docRef.current = doc
        setDocVersion(v => v + 1)
      })
      .catch((err) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = '<p style="color:crimson;padding:12px">PDF 渲染失败</p>'
        }
        console.error('pdf load error', err)
      })
    return () => { cancelled = true; void docRef.current?.destroy(); docRef.current = null }
  }, [data])

  // 缩放或新文档 → 按当前 zoom 重渲染所有页面（真实重渲染，任意倍率都锐利）
  useEffect(() => {
    const doc = docRef.current
    const container = containerRef.current
    if (!doc || !container) return
    let cancelled = false
    ;(async () => {
      container.innerHTML = ''
      // 清晰渲染：CSS 尺寸 = 适应宽度 × zoom，物理像素再 ×devicePixelRatio。
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
    })()
    return () => { cancelled = true }
  }, [zoom, docVersion])

  // 触控板捏合 / ⌘(Ctrl)+滚轮 缩放：macOS 上捏合以 ctrlKey=true 的 wheel 事件到达。
  // 累积「缩放系数」并用 setTimeout 节流提交（比 rAF 在后台窗口更可靠），
  // setZoom 用函数式更新读取最新 zoom，避免竞态。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let pendingFactor = 1
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return // 普通滚动交给容器自身
      e.preventDefault() // 阻止 Electron 默认整页缩放
      pendingFactor *= Math.exp(-e.deltaY * 0.01) // 张开(deltaY<0)放大，捏合缩小
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        const f = pendingFactor
        pendingFactor = 1
        setZoom(z => clampZoom(z * f))
      }, 80)
    }
    viewer.addEventListener('wheel', onWheel, { passive: false })
    return () => { viewer.removeEventListener('wheel', onWheel); if (timer) clearTimeout(timer) }
  }, [])

  const clamp = clampZoom

  return (
    <div className="pdf-viewer" ref={viewerRef}>
      <div className="pdf-toolbar">
        <button aria-label="缩小" title="缩小 (⌘−)" onClick={() => setZoom(z => clamp(z - ZOOM_STEP))} disabled={zoom <= ZOOM_MIN}>−</button>
        <span className="pdf-zoom-pct" title="触控板捏合 或 ⌘+滚轮 可缩放">{Math.round(zoom * 100)}%</span>
        <button aria-label="放大" title="放大 (⌘+)" onClick={() => setZoom(z => clamp(z + ZOOM_STEP))} disabled={zoom >= ZOOM_MAX}>＋</button>
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
