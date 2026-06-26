import { lazy, Suspense, useEffect, useState } from 'react'
import type { Note, Paper } from '@shared/types'
import { Markdown } from './Markdown'
import { findQuoteRange } from '../lib/quote-match'

const PdfCanvas = lazy(() => import('./PdfCanvas'))
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function ReaderView({ paper, notesVersion = 0, jumpTarget = null, onAskSelection }: {
  paper: Paper | null
  notesVersion?: number
  jumpTarget?: { paperKey: string; page: number; quote?: string; nonce: number } | null
  onAskSelection?: (text: string) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [syncing, setSyncing] = useState<string | null>(null)
  const [tab, setTab] = useState<'summary' | 'pdf'>('summary')
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deepReading, setDeepReading] = useState(false)
  const [deepReadPreview, setDeepReadPreview] = useState('')

  useEffect(() => {
    setTab('summary')
    setPdfData(null)
    setError(null)
    setDeepReadPreview('')
  }, [paper?.key])

  useEffect(() => {
    if (paper) window.api.listNotes(paper.key).then(setNotes)
    else setNotes([])
  }, [paper?.key, notesVersion])

  useEffect(() => {
    if (!jumpTarget || !paper || jumpTarget.paperKey !== paper.key) return
    let cancelled = false
    ;(async () => {
      if (tab !== 'pdf' || pdfData === null) await openPdf()
      for (let i = 0; i < 80 && !cancelled; i++) {
        const canvases = document.querySelectorAll('.pdf-stage canvas')
        if (canvases.length >= jumpTarget.page) {
          const el = canvases[jumpTarget.page - 1] as HTMLElement
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          const wrap = el.closest('.pdf-page-wrap') ?? el.parentElement
          let sentenceHit = false
          if (jumpTarget.quote && wrap) {
            const spans = [...wrap.querySelectorAll('.textLayer span')] as HTMLElement[]
            const range = findQuoteRange(spans.map(s => s.textContent ?? ''), jumpTarget.quote)
            if (range) {
              sentenceHit = true
              const targets = spans.slice(range.start, range.end + 1)
              targets.forEach(s => s.classList.add('sentence-flash'))
              setTimeout(() => targets.forEach(s => s.classList.remove('sentence-flash')), 3000)
            }
          }
          if (!sentenceHit) {
            el.classList.add('page-flash')
            setTimeout(() => el.classList.remove('page-flash'), 1500)
          }
          return
        }
        await new Promise(r => setTimeout(r, 200))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget?.nonce])

  if (!paper) return <div className="placeholder-pane">从左侧选择论文</div>

  async function sync(noteId: string) {
    setError(null)
    setSyncing(noteId)
    try {
      await window.api.syncNote({ noteId, paper: paper! })
      setNotes(await window.api.listNotes(paper!.key))
    } catch (e) {
      setError('同步到 Notion 失败：' + errMsg(e))
    } finally { setSyncing(null) }
  }

  async function openPdf() {
    setTab('pdf')
    if (pdfData === null && !pdfLoading) {
      setError(null)
      setPdfLoading(true)
      try {
        setPdfData(await window.api.getPaperPdf(paper!))
      } catch (e) {
        setError('PDF 加载失败：' + errMsg(e))
      } finally { setPdfLoading(false) }
    }
  }

  async function deepRead() {
    setError(null)
    setDeepReading(true)
    setDeepReadPreview('')
    try {
      await window.api.deepReadPaper(paper!, (delta, kind) => {
        if (kind !== 'reasoning') setDeepReadPreview(p => p + delta)
      })
      setNotes(await window.api.listNotes(paper!.key))
      setDeepReadPreview('')
    } catch (e) {
      setError('AI 精读失败：' + errMsg(e))
    } finally { setDeepReading(false) }
  }

  return (
    <div className="reader">
      <div className="reader-tabs">
        <button onClick={() => setTab('summary')} disabled={tab === 'summary'}>摘要</button>
        <button onClick={openPdf} disabled={tab === 'pdf'}>全文 PDF</button>
      </div>
      {error && <div role="alert" className="alert-banner">{error}</div>}
      {tab === 'summary' ? (
        <div style={{ overflow: 'auto' }}>
          <h2 className="reader-title">{paper.title}</h2>
          <p className="reader-authors">{paper.authors.join(', ')}{paper.year ? ` · ${paper.year}` : ''}</p>
          {paper.abstract && <p className="reader-abstract">{paper.abstract}</p>}
          <div className="notes-header">
            <h3>学习笔记</h3>
            <button className="btn-accent-soft" onClick={deepRead} disabled={deepReading}>✨ AI 精读</button>
          </div>
          <div className="deepread-preview" style={{ display: deepReading || deepReadPreview ? 'block' : 'none' }}>
            {deepReadPreview ? <Markdown>{deepReadPreview}</Markdown> : (deepReading ? '正在精读…' : '')}
          </div>
          {notes.length === 0 && <p className="empty-hint">暂无笔记，点「✨ AI 精读」一键生成，或去右侧与 AI 对话并「存为笔记」。</p>}
          <ul className="note-list">
            {notes.map(n => (
              <li key={n.id} className="note-card">
                <div><Markdown>{n.content}</Markdown></div>
                {n.tags.length > 0 && (
                  <div className="note-tags">
                    {n.tags.map(t => (
                      <span key={t} className="tag-chip">{t}</span>
                    ))}
                  </div>
                )}
                <div className="note-foot">
                  {n.notionPageId ? <span className="synced-badge">✓ 已同步 Notion</span> : (
                    <button onClick={() => sync(n.id)} disabled={syncing === n.id}>同步到 Notion</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="pdf-stage">
          {pdfLoading && <p className="empty-hint">加载 PDF…</p>}
          {!pdfLoading && pdfData === null && <p className="empty-hint">该论文在 Zotero 中没有 PDF 附件。</p>}
          {pdfData && (
            <Suspense fallback={<p className="empty-hint">渲染中…</p>}>
              <PdfCanvas data={pdfData} paperKey={paper.key} onAskSelection={onAskSelection} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  )
}
