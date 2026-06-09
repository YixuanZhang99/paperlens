import { lazy, Suspense, useEffect, useState } from 'react'
import type { Note, Paper } from '@shared/types'

const PdfCanvas = lazy(() => import('./PdfCanvas'))
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function ReaderView({ paper }: { paper: Paper | null }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [syncing, setSyncing] = useState<string | null>(null)
  const [tab, setTab] = useState<'summary' | 'pdf'>('summary')
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTab('summary')
    setPdfData(null)
    setError(null)
    if (paper) window.api.listNotes(paper.key).then(setNotes)
    else setNotes([])
  }, [paper?.key])

  if (!paper) return <div style={{ padding: 12, color: '#888' }}>从左侧选择论文</div>

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

  return (
    <div style={{ padding: 16, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => setTab('summary')} disabled={tab === 'summary'}>摘要</button>
        <button onClick={openPdf} disabled={tab === 'pdf'}>全文 PDF</button>
      </div>
      {error && <div role="alert" style={{ color: 'crimson', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {tab === 'summary' ? (
        <div style={{ overflow: 'auto' }}>
          <h2>{paper.title}</h2>
          <p style={{ color: '#666' }}>{paper.authors.join(', ')} · {paper.year ?? ''}</p>
          <p>{paper.abstract}</p>
          <h3>学习笔记</h3>
          {notes.length === 0 && <p style={{ color: '#999' }}>暂无笔记，去右侧与 AI 对话并「存为笔记」。</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {notes.map(n => (
              <li key={n.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div>{n.content}</div>
                <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
                  {n.notionPageId ? '✓ 已同步 Notion' : (
                    <button onClick={() => sync(n.id)} disabled={syncing === n.id}>同步到 Notion</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {pdfLoading && <p style={{ color: '#999' }}>加载 PDF…</p>}
          {!pdfLoading && pdfData === null && <p style={{ color: '#999' }}>该论文在 Zotero 中没有 PDF 附件。</p>}
          {pdfData && (
            <Suspense fallback={<p style={{ color: '#999' }}>渲染中…</p>}>
              <PdfCanvas data={pdfData} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  )
}
