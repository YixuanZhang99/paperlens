import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Highlight } from '@shared/types'
import { findAllMatchRanges } from '../lib/quote-match'
import { domRectToPdfRect, pdfRectToBox, isMeaningfulRect, type Rect4 } from '../lib/pdf-highlight'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(z.toFixed(2))))

// 与 Zotero 默认标注色一致
const HIGHLIGHT_COLORS = [
  { name: '黄', hex: '#ffd400' },
  { name: '绿', hex: '#5fb236' },
  { name: '蓝', hex: '#2ea8e5' },
  { name: '红', hex: '#ff6666' },
  { name: '紫', hex: '#a28ae5' },
]

export default function PdfCanvas({ data, paperKey, onAskSelection }: {
  data: ArrayBuffer
  paperKey: string
  onAskSelection?: (text: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const viewportsRef = useRef<Record<number, pdfjsLib.PageViewport>>({}) // 按 0 基页码存当前 viewport
  const [docVersion, setDocVersion] = useState(0) // 文档加载完成后 +1，触发页面渲染
  const [zoom, setZoom] = useState(1) // 1 = 适应宽度
  const [sel, setSel] = useState<{ x: number; y: number; text: string } | null>(null)
  // 页内搜索（Ctrl/Cmd+F）
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<HTMLElement[][]>([])
  const [cur, setCur] = useState(0)
  const [renderTick, setRenderTick] = useState(0) // textLayer 重渲染后 +1，触发重匹配/重绘高亮
  // 高亮标注
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [color, setColor] = useState(HIGHLIGHT_COLORS[0].hex)
  const [activeHl, setActiveHl] = useState<{ hl: Highlight; x: number; y: number } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const unsyncedCount = highlights.filter(h => !h.zoteroKey).length

  // 载入该论文已有高亮
  useEffect(() => {
    let alive = true
    setActiveHl(null)
    window.api.listHighlights(paperKey).then(hs => { if (alive) setHighlights(hs) }).catch(() => {})
    return () => { alive = false }
  }, [paperKey])

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
      viewportsRef.current = {}
      const fitWidth = container.clientWidth || 800
      const dpr = window.devicePixelRatio || 1
      for (let i = 1; i <= doc.numPages && !cancelled; i++) {
        const page = await doc.getPage(i)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (fitWidth / base.width) * zoom })
        const cssWidth = Math.floor(viewport.width)
        viewportsRef.current[i - 1] = viewport

        const wrap = document.createElement('div')
        wrap.className = 'pdf-page-wrap'
        wrap.dataset.pageIndex = String(i - 1)
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
      if (!cancelled) setRenderTick(t => t + 1)
    })()
    return () => { cancelled = true }
  }, [zoom, docVersion])

  // 重绘高亮叠加层（高亮变化 / 页面重渲染后）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.querySelectorAll('.pdf-hl').forEach(e => e.remove())
    for (const hl of highlights) {
      const wrap = container.querySelector<HTMLElement>(`.pdf-page-wrap[data-page-index="${hl.pageIndex}"]`)
      const vp = viewportsRef.current[hl.pageIndex]
      if (!wrap || !vp) continue
      for (const rect of hl.rects) {
        const box = pdfRectToBox(rect as Rect4, (r) => vp.convertToViewportRectangle(r))
        if (!isMeaningfulRect(box)) continue
        const div = document.createElement('div')
        div.className = 'pdf-hl' + (hl.comment ? ' has-comment' : '')
        div.dataset.hlId = hl.id
        div.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;background:${hl.color}`
        if (hl.comment) div.title = `📝 ${hl.comment}`
        wrap.appendChild(div)
      }
    }
  }, [highlights, renderTick])

  // 关闭弹窗前把注释存掉（单一保存出口，避免 onBlur/完成/外部点击多路径竞态丢输入）
  function saveAndClose() {
    if (activeHl) {
      const v = noteRef.current?.value.trim() || null
      if (v !== (activeHl.hl.comment ?? null)) void updateActiveHl({ comment: v })
    }
    setActiveHl(null)
  }

  // 弹窗：点击外部 / 滚动时保存并关闭
  useEffect(() => {
    if (!activeHl) return
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) saveAndClose()
    }
    const onScroll = () => saveAndClose()
    document.addEventListener('mousedown', onDown)
    const stage = viewerRef.current?.parentElement // 真正的滚动容器是 .pdf-stage
    stage?.addEventListener('scroll', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      stage?.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHl])

  // 触控板捏合 / ⌘(Ctrl)+滚轮 缩放
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let pendingFactor = 1
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      pendingFactor *= Math.exp(-e.deltaY * 0.01)
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

  // 由当前选区创建高亮；按 client 矩形所属页面分组（跨页选区每页各存一条），
  // withNote=true 时创建后打开首条的注释弹窗
  async function createHighlight(withNote: boolean) {
    const s = window.getSelection()
    if (!s || s.rangeCount === 0) return
    const text = s.toString().trim()
    const container = containerRef.current
    if (!text || !container) return
    const range = s.getRangeAt(0)
    const wraps = [...container.querySelectorAll<HTMLElement>('.pdf-page-wrap')]
    // 用矩形中心点判定所属页面
    const byPage = new Map<number, DOMRect[]>()
    for (const r of Array.from(range.getClientRects())) {
      if (!isMeaningfulRect(r)) continue
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2
      const wrap = wraps.find(w => {
        const wr = w.getBoundingClientRect()
        return cx >= wr.left && cx <= wr.right && cy >= wr.top && cy <= wr.bottom
      })
      const pi = wrap?.dataset.pageIndex
      if (pi == null) continue
      const k = Number(pi)
      let arr = byPage.get(k)
      if (!arr) { arr = []; byPage.set(k, arr) }
      arr.push(r)
    }
    if (byPage.size === 0) return
    const created: Highlight[] = []
    for (const [pageIndex, clientRects] of byPage) {
      const wrap = wraps.find(w => Number(w.dataset.pageIndex) === pageIndex)
      const vp = viewportsRef.current[pageIndex]
      if (!wrap || !vp) continue
      const wrapRect = wrap.getBoundingClientRect()
      const rects: number[][] = clientRects.map(r => domRectToPdfRect(
        { left: r.left - wrapRect.left, top: r.top - wrapRect.top, right: r.right - wrapRect.left, bottom: r.bottom - wrapRect.top },
        (x, y) => vp.convertToPdfPoint(x, y),
      ))
      if (rects.length === 0) continue
      try {
        created.push(await window.api.addHighlight({ paperKey, pageIndex, rects, text, color }))
      } catch (e) {
        setSyncMsg('保存高亮失败：' + (e instanceof Error ? e.message : String(e)))
      }
    }
    if (created.length === 0) return
    setHighlights(hs => [...hs, ...created])
    s.removeAllRanges()
    setSel(null)
    if (withNote) {
      const vr = viewerRef.current!.getBoundingClientRect()
      setActiveHl({ hl: created[0], x: Math.min(sel?.x ?? 40, vr.width - 280), y: (sel?.y ?? 40) + 8 })
    }
  }

  async function updateActiveHl(patch: { comment?: string | null; color?: string }) {
    if (!activeHl) return
    const id = activeHl.hl.id
    await window.api.updateHighlight({ id, ...patch }).catch(() => {})
    setHighlights(hs => hs.map(h => h.id === id ? { ...h, ...patch } : h))
    setActiveHl(a => a && a.hl.id === id ? { ...a, hl: { ...a.hl, ...patch } } : a)
  }

  async function deleteActiveHl() {
    if (!activeHl) return
    const id = activeHl.hl.id
    await window.api.deleteHighlight(id).catch(() => {})
    setHighlights(hs => hs.filter(h => h.id !== id))
    setActiveHl(null)
  }

  // 点击页面：若不是拖选结束（无选中文本），按几何命中已有高亮 → 打开其编辑弹窗
  function onPagesClick(e: React.MouseEvent) {
    if ((window.getSelection()?.toString() ?? '').trim()) return
    const container = containerRef.current
    if (!container) return
    const hit = [...container.querySelectorAll<HTMLElement>('.pdf-hl')].find(d => {
      const r = d.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    })
    const id = hit?.dataset.hlId
    if (!id) return
    const hl = highlights.find(h => h.id === id)
    if (!hl) return
    const vr = viewerRef.current!.getBoundingClientRect()
    const br = hit!.getBoundingClientRect()
    setActiveHl({ hl, x: br.left - vr.left, y: br.bottom - vr.top + 4 })
  }

  async function syncToZotero() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const { synced, failed } = await window.api.syncHighlights(paperKey)
      setHighlights(await window.api.listHighlights(paperKey))
      setSyncMsg(failed ? `已同步 ${synced} 条，${failed} 条失败` : `已同步 ${synced} 条到 Zotero ✓`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSyncMsg(/403|write|permission/i.test(msg)
        ? '同步失败：Zotero key 无写权限。请到 zotero.org/settings/keys 给 key 勾选「Allow write access」。'
        : '同步失败：' + msg)
    } finally {
      setSyncing(false)
    }
  }

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
        <span className="pdf-toolbar-sep" />
        <span className="pdf-hl-count" title="高亮标注数">🖍️ {highlights.length}</span>
        <button
          className="pdf-sync-btn"
          onClick={syncToZotero}
          disabled={syncing || unsyncedCount === 0}
          title="把未同步的高亮推送到 Zotero（需写权限 key）"
        >{syncing ? '同步中…' : `同步Zotero${unsyncedCount ? ` (${unsyncedCount})` : ''}`}</button>
      </div>
      {syncMsg && <div className="pdf-sync-msg" role="status" onClick={() => setSyncMsg(null)}>{syncMsg}</div>}
      <div ref={containerRef} className="pdf-pages" onClick={onPagesClick} />

      {sel && (
        <div className="sel-toolbar" style={{ position: 'absolute', left: sel.x, top: sel.y, zIndex: 6 }}
          onMouseDown={e => e.preventDefault()}>
          {HIGHLIGHT_COLORS.map(c => (
            <button
              key={c.hex}
              className={'sel-color' + (color === c.hex ? ' active' : '')}
              style={{ background: c.hex }}
              title={`高亮(${c.name})`}
              onClick={() => { setColor(c.hex); void createHighlight(false) }}
            />
          ))}
          <button className="sel-act" title="高亮并加笔记" onClick={() => createHighlight(true)}>📝</button>
          {onAskSelection && <button className="sel-act" onClick={() => { onAskSelection(sel.text); setSel(null) }}>✨问这段</button>}
        </div>
      )}

      {activeHl && (
        <div className="hl-popover" ref={popoverRef}
          style={{ position: 'absolute', left: Math.max(8, activeHl.x), top: activeHl.y, zIndex: 7 }}>
          <div className="hl-pop-colors">
            {HIGHLIGHT_COLORS.map(c => (
              <button key={c.hex} className={'sel-color' + (activeHl.hl.color === c.hex ? ' active' : '')}
                style={{ background: c.hex }} title={c.name}
                onClick={() => updateActiveHl({ color: c.hex })} />
            ))}
            <span className="hl-pop-status">{activeHl.hl.zoteroKey ? '✓ 已同步' : '未同步'}</span>
          </div>
          <textarea
            key={activeHl.hl.id}
            ref={noteRef}
            className="hl-pop-note"
            placeholder="加条笔记（注释）…"
            defaultValue={activeHl.hl.comment ?? ''}
          />
          <div className="hl-pop-foot">
            <button className="hl-pop-del" onClick={deleteActiveHl}>删除</button>
            <button onClick={saveAndClose}>完成</button>
          </div>
        </div>
      )}
    </div>
  )
}
