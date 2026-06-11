import { useEffect, useMemo, useState } from 'react'
import type { ChatMessage, Note, ZoteroCollection } from '@shared/types'
import { Markdown } from './Markdown'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// 与 preload kbAsk 返回结构一致（chunks 为命中原文片段，支撑「信任链」展示）
type KbSource = { paperKey: string; paperTitle: string; chunks: string[] }
type KbTurn = { q: string; a: string; sources: KbSource[] }

function loadTurns(): KbTurn[] {
  try { return JSON.parse(localStorage.getItem('pl.kb.turns') || '[]') } catch { return [] }
}

export function KnowledgeView({ onOpenPaper }: { onOpenPaper: (paperKey: string) => void }) {
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [turns, setTurns] = useState<KbTurn[]>(loadTurns)
  const [pending, setPending] = useState<{ q: string; a: string } | null>(null)
  const [expanded, setExpanded] = useState<{ t: number; s: number } | null>(null)
  const [savedTurns, setSavedTurns] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [tab, setTabState] = useState<'notes' | 'index'>(() =>
    localStorage.getItem('pl.kb.tab') === 'index' ? 'index' : 'notes')
  const [notes, setNotes] = useState<Note[]>([])
  const [paperTitles, setPaperTitles] = useState<Map<string, string>>(new Map())
  const [keyword, setKeyword] = useState(() => localStorage.getItem('pl.kb.keyword') ?? '')
  const [activeTag, setActiveTag] = useState<string | null>(() => localStorage.getItem('pl.kb.tag') || null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [status, setStatus] = useState<{ indexedPapers: number; totalPapers: number; totalChunks: number } | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [progress, setProgress] = useState('')
  // 自动综述状态
  const [collections, setCollections] = useState<ZoteroCollection[]>([])
  const [revScope, setRevScope] = useState('')
  const [revConfirm, setRevConfirm] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [revProgress, setRevProgress] = useState('')
  const [revPreview, setRevPreview] = useState('')
  const [revDone, setRevDone] = useState<{ content: string; papers: number } | null>(null)
  const [revSaved, setRevSaved] = useState(false)
  const [revPaperKey, setRevPaperKey] = useState('')

  useEffect(() => {
    window.api.listAllNotes().then(setNotes).catch(() => {})
    window.api.kbStatus().then(setStatus).catch(() => {})
    window.api.listPapers().catch(() => [])
      .then(ps => setPaperTitles(new Map(ps.map(p => [p.key, p.title]))))
    window.api.listCollections().catch(() => []).then(setCollections)
    runIndex() // 打开即后台增量索引（已索引的论文会秒过）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 对话线程持久化（最多 20 轮）
  useEffect(() => {
    localStorage.setItem('pl.kb.turns', JSON.stringify(turns.slice(-20)))
  }, [turns])

  // 笔记筛选状态持久化：跳走再回来不丢
  useEffect(() => { localStorage.setItem('pl.kb.tab', tab) }, [tab])
  useEffect(() => { localStorage.setItem('pl.kb.keyword', keyword) }, [keyword])
  useEffect(() => {
    if (activeTag) localStorage.setItem('pl.kb.tag', activeTag)
    else localStorage.removeItem('pl.kb.tag')
  }, [activeTag])

  // 「确认删除？」3 秒或点击其他地方自动复位
  useEffect(() => {
    if (!confirmDel) return
    const timer = setTimeout(() => setConfirmDel(null), 3000)
    const reset = () => setConfirmDel(null)
    document.addEventListener('click', reset)
    return () => { clearTimeout(timer); document.removeEventListener('click', reset) }
  }, [confirmDel])

  async function runIndex() {
    setIndexing(true)
    try {
      await window.api.kbIndex((done, total, title) => setProgress(`${done}/${total} ${title}`))
      setStatus(await window.api.kbStatus())
    } catch (e) {
      setError('索引失败：' + errMsg(e))
    } finally { setIndexing(false); setProgress('') }
  }

  async function startReview() {
    const scopeLabel = revScope
      ? (collections.find(c => c.key === revScope)?.name ?? revScope)
      : '全部论文'
    setRevConfirm(false)
    setReviewing(true)
    setRevPreview('')
    setRevDone(null)
    setRevSaved(false)
    setRevProgress('')
    let firstPaperKey = ''
    try {
      const ps = await window.api.listPapers(revScope || null)
      firstPaperKey = ps[0]?.key ?? ''
    } catch { /* 忽略，存按钮禁用 */ }
    setRevPaperKey(firstPaperKey)
    try {
      const result = await window.api.kbReview(
        { collectionKey: revScope || null, scopeLabel },
        (done, total, title) => setRevProgress(`${done}/${total} ${title}`),
        (delta, kind) => { if (kind !== 'reasoning') setRevPreview(p => p + delta) },
      )
      setRevDone({ content: result.content, papers: result.papers })
    } catch (e) {
      setError('综述失败：' + errMsg(e))
    } finally {
      setReviewing(false)
      setRevProgress('')
    }
  }

  function resetReview() {
    setRevConfirm(false)
    setReviewing(false)
    setRevProgress('')
    setRevPreview('')
    setRevDone(null)
    setRevSaved(false)
    setRevPaperKey('')
  }

  async function saveReviewAsNote() {
    if (!revDone || revSaved || !revPaperKey) return
    const scopeLabel = revScope
      ? (collections.find(c => c.key === revScope)?.name ?? revScope)
      : '全部论文'
    const content = `# 文献综述（${scopeLabel}，${revDone.papers} 篇）\n\n` + revDone.content
    try {
      await window.api.addNote({ paperKey: revPaperKey, content, tags: [], autoTag: true })
      setRevSaved(true)
      window.api.listAllNotes().then(setNotes).catch(() => {})
    } catch (e) {
      setError('存为笔记失败：' + errMsg(e))
    }
  }

  async function ask() {
    const q = question.trim()
    if (!q || asking) return
    setError(null)
    // 最近 3 轮作为对话历史，支撑追问指代
    const history: ChatMessage[] = turns.slice(-3).flatMap(t => [
      { role: 'user' as const, content: t.q },
      { role: 'assistant' as const, content: t.a },
    ])
    setQuestion('')
    setPending({ q, a: '' })
    setAsking(true)
    try {
      const r = await window.api.kbAsk({ question: q, history }, (delta, kind) => {
        if (kind !== 'reasoning') setPending(p => (p ? { ...p, a: p.a + delta } : p))
      })
      setTurns(ts => [...ts, { q, a: r.answer, sources: r.sources }])
    } catch (e) {
      setError('问答失败：' + errMsg(e))
    } finally { setAsking(false); setPending(null) }
  }

  function clearThread() {
    setTurns([])
    setExpanded(null)
    setSavedTurns(new Set())
    localStorage.removeItem('pl.kb.turns')
  }

  async function saveTurnAsNote(idx: number) {
    const t = turns[idx]
    if (!t || t.sources.length === 0 || savedTurns.has(idx)) return
    const content =
      `## 全库问答\n\n**问**：${t.q}\n\n${t.a}\n\n**来源**：\n` +
      t.sources.map((s, i) => `${i + 1}. ${s.paperTitle}`).join('\n')
    try {
      await window.api.addNote({ paperKey: t.sources[0].paperKey, content, tags: [], autoTag: true })
      setSavedTurns(prev => new Set(prev).add(idx))
      window.api.listAllNotes().then(setNotes).catch(() => {})
    } catch (e) {
      setError('存为笔记失败：' + errMsg(e))
    }
  }

  async function deleteNote(id: string) {
    try {
      await window.api.deleteNote(id)
      setNotes(await window.api.listAllNotes())
    } catch (e) {
      setError('删除失败：' + errMsg(e))
    }
  }

  function switchTab(t: 'notes' | 'index') {
    setTabState(t)
    setError(null)
  }

  const allTags = useMemo(() => [...new Set(notes.flatMap(n => n.tags))], [notes])
  const filtered = notes.filter(n =>
    (!activeTag || n.tags.includes(activeTag)) &&
    (!keyword.trim() || n.content.includes(keyword.trim())))

  return (
    <div className="kb">
      <h2 className="kb-title">🧠 知识库</h2>
      {error && (
        <div role="alert" className="alert-banner">
          {error}
          <button className="kb-alert-close" aria-label="关闭错误提示" onClick={() => setError(null)}>×</button>
        </div>
      )}
      <div className="kb-ask">
        {(turns.length > 0 || pending) && (
          <div className="kb-thread-head">
            <button className="btn-ghost" onClick={clearThread}>清空对话</button>
          </div>
        )}
        {(turns.length > 0 || pending) && (
          <div className="kb-thread">
            {turns.map((t, ti) => (
              <div key={ti} className="kb-turn">
                <div className="kb-q">{t.q}</div>
                <div className="kb-a"><Markdown>{t.a}</Markdown></div>
                {t.sources.length > 0 && (
                  <>
                    <div className="kb-sources">
                      {t.sources.map((s, si) => (
                        <button
                          key={s.paperKey}
                          className={'chip' + (expanded?.t === ti && expanded.s === si ? ' chip-active' : '')}
                          onClick={() => setExpanded(expanded?.t === ti && expanded.s === si ? null : { t: ti, s: si })}>
                          [来源{si + 1}] {s.paperTitle}
                        </button>
                      ))}
                      <button
                        className="chip kb-save-note"
                        disabled={savedTurns.has(ti)}
                        onClick={() => saveTurnAsNote(ti)}>
                        {savedTurns.has(ti) ? '✓ 已存为笔记' : '存为笔记'}
                      </button>
                    </div>
                    {expanded?.t === ti && t.sources[expanded.s] && (
                      <div className="kb-source-panel">
                        {t.sources[expanded.s].chunks.map((c, ci) => (
                          <blockquote key={ci} className="kb-quote">{c}</blockquote>
                        ))}
                        <button onClick={() => onOpenPaper(t.sources[expanded.s].paperKey)}>打开论文 →</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {pending && (
              <div className="kb-turn">
                <div className="kb-q">{pending.q}</div>
                <div className="kb-a">
                  {pending.a ? <Markdown>{pending.a}</Markdown> : '检索并思考中…'}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="input-row">
          <input
            placeholder="向整个论文库提问，例如：哪些论文讨论了 RLHF？各自怎么做的？"
            value={question} onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) ask() }} />
          <button className="btn-primary" onClick={ask} disabled={asking}>提问</button>
        </div>
      </div>
      <div className="reader-tabs" style={{ marginTop: 14 }}>
        <button onClick={() => switchTab('notes')} disabled={tab === 'notes'}>📝 我的笔记</button>
        <button onClick={() => switchTab('index')} disabled={tab === 'index'}>📄 索引状态</button>
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
              <li key={n.id} className="note-card kb-note">
                <div className="kb-note-meta">
                  <span>{paperTitles.get(n.paperKey) ?? n.paperKey}</span>
                  <span>{new Date(n.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="kb-note-body"><Markdown>{n.content}</Markdown></div>
                <div className="kb-note-foot">
                  {n.tags.length > 0 && (
                    <div className="note-tags">{n.tags.map(t => <span key={t} className="tag-chip">{t}</span>)}</div>
                  )}
                  <button onClick={e => { e.stopPropagation(); onOpenPaper(n.paperKey) }}>打开论文 →</button>
                  <button
                    className={confirmDel === n.id ? 'btn-danger' : ''}
                    onClick={e => {
                      e.stopPropagation()
                      if (confirmDel === n.id) { setConfirmDel(null); deleteNote(n.id) }
                      else setConfirmDel(n.id)
                    }}>
                    {confirmDel === n.id ? '确认删除？' : '删除'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="kb-index">
          {status && <p>已索引 <b>{status.indexedPapers} / {status.totalPapers}</b> 篇论文，共 {status.totalChunks} 个片段。</p>}
          {indexing && <p className="empty-hint">索引中：{progress || '准备中…'}</p>}
          <button onClick={runIndex} disabled={indexing}>更新索引</button>
          <div className="kb-review">
            <div className="kb-review-head">
              <span>📝 生成综述</span>
              <select
                aria-label="综述范围"
                value={revScope}
                onChange={e => { setRevScope(e.target.value); setRevConfirm(false) }}
                disabled={reviewing}>
                <option value="">全部论文</option>
                {collections.map(c => (
                  <option key={c.key} value={c.key}>{c.name}</option>
                ))}
              </select>
              {!revConfirm && !reviewing && !revDone && (
                <button onClick={() => setRevConfirm(true)}>生成综述</button>
              )}
              {(revDone || reviewing) && (
                <button className="btn-ghost" onClick={resetReview} disabled={reviewing}>清空</button>
              )}
            </div>
            {revConfirm && !reviewing && !revDone && (
              <div className="kb-review-head" style={{ marginTop: 8 }}>
                <span>将对范围内每篇已索引论文发起 1 次提炼调用 + 1 次汇总调用，确认生成？</span>
                <button className="btn-primary" onClick={startReview}>确认生成</button>
                <button onClick={() => setRevConfirm(false)}>取消</button>
              </div>
            )}
            {reviewing && (
              <p className="empty-hint">综述中：{revProgress || '准备中…'}</p>
            )}
            {(reviewing || revDone) && revPreview && (
              <div className="kb-review-preview">
                <Markdown>{revPreview}</Markdown>
              </div>
            )}
            {revDone && (
              <div className="kb-review-head" style={{ marginTop: 8 }}>
                <button
                  onClick={saveReviewAsNote}
                  disabled={revSaved || !revPaperKey}>
                  {revSaved ? '✓ 已存为笔记' : '存为笔记'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
