import { useEffect, useMemo, useState } from 'react'
import type { Note } from '@shared/types'
import { Markdown } from './Markdown'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
type Source = { paperKey: string; title: string }

export function KnowledgeView({ onOpenPaper }: { onOpenPaper: (paperKey: string) => void }) {
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<Source[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'notes' | 'index'>('notes')
  const [notes, setNotes] = useState<Note[]>([])
  const [keyword, setKeyword] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [status, setStatus] = useState<{ indexedPapers: number; totalPapers: number; totalChunks: number } | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [progress, setProgress] = useState('')

  useEffect(() => {
    window.api.listAllNotes().then(setNotes).catch(() => {})
    window.api.kbStatus().then(setStatus).catch(() => {})
    runIndex() // 打开即后台增量索引（已索引的论文会秒过）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runIndex() {
    setIndexing(true)
    try {
      await window.api.kbIndex((done, total, title) => setProgress(`${done}/${total} ${title}`))
      setStatus(await window.api.kbStatus())
    } catch (e) {
      setError('索引失败：' + errMsg(e))
    } finally { setIndexing(false); setProgress('') }
  }

  async function ask() {
    const q = question.trim()
    if (!q || asking) return
    setError(null); setAnswer(''); setSources([]); setAsking(true)
    try {
      const r = await window.api.kbAsk(q, (delta, kind) => {
        if (kind !== 'reasoning') setAnswer(a => a + delta)
      })
      setSources(r.sources)
    } catch (e) {
      setError('问答失败：' + errMsg(e))
    } finally { setAsking(false) }
  }

  const allTags = useMemo(() => [...new Set(notes.flatMap(n => n.tags))], [notes])
  const filtered = notes.filter(n =>
    (!activeTag || n.tags.includes(activeTag)) &&
    (!keyword.trim() || n.content.includes(keyword.trim())))

  return (
    <div className="kb">
      <h2 className="kb-title">🧠 知识库</h2>
      {error && <div role="alert" className="alert-banner">{error}</div>}
      <div className="kb-ask">
        <div className="input-row">
          <input
            placeholder="向整个论文库提问，例如：哪些论文讨论了 RLHF？各自怎么做的？"
            value={question} onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') ask() }} />
          <button className="btn-primary" onClick={ask} disabled={asking}>提问</button>
        </div>
        {(answer || asking) && (
          <div className="kb-answer">
            {answer ? <Markdown>{answer}</Markdown> : '检索并思考中…'}
            {sources.length > 0 && (
              <div className="kb-sources">
                {sources.map((s, i) => (
                  <button key={s.paperKey} className="chip" onClick={() => onOpenPaper(s.paperKey)}>
                    [来源{i + 1}] {s.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="reader-tabs" style={{ marginTop: 14 }}>
        <button onClick={() => setTab('notes')} disabled={tab === 'notes'}>📝 我的笔记</button>
        <button onClick={() => setTab('index')} disabled={tab === 'index'}>📄 索引状态</button>
      </div>
      {tab === 'notes' ? (
        <div className="kb-notes">
          <div className="input-row" style={{ marginBottom: 8 }}>
            <input placeholder="搜索笔记…" value={keyword} onChange={e => setKeyword(e.target.value)} />
          </div>
          <div className="chip-row">
            {allTags.map(t => (
              <button key={t} className={'chip' + (activeTag === t ? ' chip-active' : '')}
                onClick={() => setActiveTag(activeTag === t ? null : t)}>{t}</button>
            ))}
          </div>
          {filtered.length === 0 && <p className="empty-hint">没有匹配的笔记。</p>}
          <ul className="note-list">
            {filtered.map(n => (
              <li key={n.id} className="note-card kb-note" onClick={() => onOpenPaper(n.paperKey)}>
                <div><Markdown>{n.content}</Markdown></div>
                {n.tags.length > 0 && (
                  <div className="note-tags">{n.tags.map(t => <span key={t} className="tag-chip">{t}</span>)}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="kb-index">
          {status && <p>已索引 <b>{status.indexedPapers} / {status.totalPapers}</b> 篇论文，共 {status.totalChunks} 个片段。</p>}
          {indexing && <p className="empty-hint">索引中：{progress || '准备中…'}</p>}
          <button onClick={runIndex} disabled={indexing}>更新索引</button>
        </div>
      )}
    </div>
  )
}
