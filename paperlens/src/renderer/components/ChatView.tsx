import { useEffect, useRef, useState, useCallback } from 'react'
import type { ChatMessage, Paper } from '@shared/types'
import { Markdown } from './Markdown'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const QUICK_PROMPTS: Array<{ label: string; prompt: string }> = [
  { label: '核心贡献', prompt: '这篇论文的核心贡献是什么？' },
  { label: '方法解读', prompt: '请解读论文的方法部分，关键设计是什么？' },
  { label: '实验与结论', prompt: '论文的实验设置和主要结论是什么？' },
  { label: '局限与改进', prompt: '这篇论文有哪些局限性？可以如何改进？' },
  { label: '大白话解释', prompt: '用通俗的大白话解释这篇论文做了什么、为什么重要。' },
]

// 气泡 = 共享 ChatMessage + 仅 UI 持有的思维链（传给 API 前剥离）
type Bubble = ChatMessage & { reasoning?: string }

type StreamResult = { text: string; truncated: boolean; usedChars: number; totalChars: number }

export function ChatView({ paper, onNoteSaved, onPageJump, quote }: { paper: Paper | null; onNoteSaved?: () => void; onPageJump?: (page: number) => void; quote?: { text: string; nonce: number } | null }) {
  const [history, setHistory] = useState<Bubble[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [deepThink, setDeepThink] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [textReady, setTextReady] = useState(false)
  const [lastStream, setLastStream] = useState<StreamResult | null>(null)
  const [followups, setFollowups] = useState<string[]>([])
  const paperText = useRef('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 选中文字引用注入：仅在 nonce 变化时注入一次，避免 rerender 覆盖用户编辑
  const lastQuoteNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!quote || quote.nonce === lastQuoteNonce.current) return
    lastQuoteNonce.current = quote.nonce
    setInput(prev => `针对这段内容：\n「${quote.text}」\n\n` + prev)
    taRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.nonce])

  // 自动滚动到底：history 流式增长、followups 异步出现、busy 切换都要跟随。
  // rAF 兜底——Markdown 在 commit 后才完成布局，单次设置会停在旧高度。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const toBottom = () => { el.scrollTop = el.scrollHeight }
    toBottom()
    const raf = requestAnimationFrame(toBottom)
    return () => cancelAnimationFrame(raf)
  }, [history, followups, busy])

  useEffect(() => {
    setHistory([])
    setError(null)
    setTextReady(false)
    setLastStream(null)
    setFollowups([])
    paperText.current = ''
    if (!paper) return
    // 竞态守卫：切到别的论文后，本次的异步结果不得再写入（cleanup 置 cancelled）
    let cancelled = false
    window.api.loadChat(paper.key).then(records => {
      if (!cancelled) {
        setHistory(records.map(r => ({ role: r.role, content: r.content, reasoning: r.reasoning ?? undefined })))
      }
    }).catch(() => { /* ignore */ })
    window.api.getPaperTextPaged(paper).then(t => {
      if (!cancelled) {
        paperText.current = t
        setTextReady(true)
      }
    }).catch(() => {
      if (!cancelled) setTextReady(true)
    })
    return () => { cancelled = true }
  }, [paper?.key])

  const send = useCallback(async (text?: string) => {
    if (!paper) return
    const q = (text ?? input).trim()
    if (!q || busy || !textReady) return
    setError(null)
    setFollowups([])
    const userMsg: Bubble = { role: 'user', content: q }
    const priorHistory = history
    const newHistory = [...priorHistory, userMsg, { role: 'assistant' as const, content: '' }]
    setHistory(newHistory)
    if (text === undefined) setInput('')
    setBusy(true)
    let assistantContent = ''
    let assistantReasoning = ''
    try {
      // Persist user message
      await window.api.appendChat({ paperKey: paper.key, role: 'user', content: q }).catch(() => { /* ignore */ })

      const result = await window.api.streamChat(
        {
          paper: paper!, paperText: paperText.current,
          history: priorHistory.map(({ role, content }) => ({ role, content })),
          input: q, deepThink,
        },
        (delta, kind) => {
          setHistory(h => {
            const copy = h.slice()
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              if (kind === 'reasoning') {
                assistantReasoning += delta
                copy[copy.length - 1] = { ...last, reasoning: (last.reasoning ?? '') + delta }
              } else {
                assistantContent += delta
                copy[copy.length - 1] = { ...last, content: last.content + delta }
              }
            }
            return copy
          })
        },
      )
      setLastStream(result)

      // Persist assistant message
      const finalContent = result.text || assistantContent
      await window.api.appendChat({
        paperKey: paper.key, role: 'assistant',
        content: finalContent,
        reasoning: assistantReasoning || null,
      }).catch(() => { /* ignore */ })

      // Fetch follow-up suggestions
      window.api.getFollowups({ paperTitle: paper.title, lastAnswer: finalContent })
        .then(fups => setFollowups(fups))
        .catch(() => setFollowups([]))
    } catch (e) {
      setError('AI 回复失败：' + errMsg(e))
      setHistory(h => {
        const last = h[h.length - 1]
        return last && last.role === 'assistant' && !last.content ? h.slice(0, -1) : h
      })
    } finally {
      setBusy(false)
    }
  }, [paper, input, busy, textReady, history, deepThink])

  const regenerate = useCallback(async (assistantIdx: number) => {
    if (!paper || busy) return
    // Find the user message that preceded this assistant message
    const priorHistory = history.slice(0, assistantIdx)
    const userMsg = [...priorHistory].reverse().find(m => m.role === 'user')
    if (!userMsg) return
    // Remove the assistant bubble and everything after
    setHistory(priorHistory)
    setFollowups([])
    setError(null)
    const q = userMsg.content
    const prevHistory = priorHistory.slice(0, priorHistory.lastIndexOf(userMsg))
    setHistory([...priorHistory, { role: 'assistant', content: '' }])
    setBusy(true)
    let assistantContent = ''
    let assistantReasoning = ''
    try {
      const result = await window.api.streamChat(
        {
          paper: paper!, paperText: paperText.current,
          history: prevHistory.map(({ role, content }) => ({ role, content })),
          input: q, deepThink,
        },
        (delta, kind) => {
          setHistory(h => {
            const copy = h.slice()
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              if (kind === 'reasoning') {
                assistantReasoning += delta
                copy[copy.length - 1] = { ...last, reasoning: (last.reasoning ?? '') + delta }
              } else {
                assistantContent += delta
                copy[copy.length - 1] = { ...last, content: last.content + delta }
              }
            }
            return copy
          })
        },
      )
      setLastStream(result)
      const finalContent = result.text || assistantContent
      // 重新生成必须丢弃旧回答及其后的持久化记录，否则切回论文时旧回答会复现。
      // 用 priorHistory + 新回答整体重写该论文，保证 DB 与 UI 一致。
      const persisted = [
        ...priorHistory
          .filter((m): m is Bubble & { role: 'user' | 'assistant' } => m.role !== 'system')
          .map(m => ({ role: m.role, content: m.content, reasoning: m.reasoning ?? null })),
        { role: 'assistant' as const, content: finalContent, reasoning: assistantReasoning || null },
      ]
      await window.api.replaceChat(paper.key, persisted).catch(() => { /* ignore */ })
      window.api.getFollowups({ paperTitle: paper.title, lastAnswer: finalContent })
        .then(fups => setFollowups(fups))
        .catch(() => setFollowups([]))
    } catch (e) {
      setError('AI 回复失败：' + errMsg(e))
      setHistory(h => {
        const last = h[h.length - 1]
        return last && last.role === 'assistant' && !last.content ? h.slice(0, -1) : h
      })
    } finally {
      setBusy(false)
    }
  }, [paper, busy, history, deepThink])

  async function clearChat() {
    if (!paper) return
    await window.api.clearChat(paper.key).catch(() => { /* ignore */ })
    setHistory([])
    setFollowups([])
    setLastStream(null)
  }

  if (!paper) return <div className="placeholder-pane">请选择一篇论文开始对话</div>

  const ctxLine = !textReady
    ? '正文加载中…'
    : lastStream
      ? lastStream.truncated
        ? `⚠ 正文较长，已读入首尾约 ${Math.round(lastStream.usedChars / 10000)} 万字（共 ${Math.round(lastStream.totalChars / 10000)} 万字）`
        : '✓ 已读入全文'
      : '正文已就绪'

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {history.length === 0 && textReady && (
          <div className="chat-empty">💬 问我关于这篇论文的任何问题，或点下方快捷提问</div>
        )}
        {history.map((m, i) => (
          <div key={i} className={'bubble-row ' + (m.role === 'user' ? 'user' : 'assistant')}>
            {m.role === 'assistant' && m.reasoning && (
              <details className="reasoning-details">
                <summary>💭 思考过程（点击展开）</summary>
                <div className="reasoning-block">{m.reasoning}</div>
              </details>
            )}
            {m.role === 'assistant' ? (
              <div className="bubble assistant bubble-wrap">
                {m.content ? <Markdown onPageJump={onPageJump}>{m.content}</Markdown> : (busy && i === history.length - 1 ? '…' : '')}
                <div className="bubble-ops">
                  <button
                    className="btn-ghost bubble-op-btn"
                    title="复制"
                    onClick={() => navigator.clipboard.writeText(m.content)}
                  >复制</button>
                  <button
                    className="btn-ghost bubble-op-btn"
                    title="重新生成"
                    disabled={busy}
                    onClick={() => regenerate(i)}
                  >重新生成</button>
                  <button
                    className="btn-ghost bubble-op-btn"
                    title="存为笔记"
                    disabled={busy || !m.content}
                    onClick={async () => {
                      const userBefore = [...history].slice(0, i).reverse().find(h => h.role === 'user')
                      const noteContent = userBefore
                        ? `Q: ${userBefore.content}\n\nA: ${m.content}`
                        : m.content
                      await window.api.addNote({ paperKey: paper!.key, content: noteContent, tags: [], autoTag: true })
                      onNoteSaved?.()
                    }}
                  >存为笔记</button>
                </div>
              </div>
            ) : (
              <span className="bubble user">{m.content}</span>
            )}
          </div>
        ))}
        {followups.length > 0 && !busy && (
          <div className="followup-row chip-row">
            {followups.map((f, i) => (
              <button key={i} className="chip" onClick={() => send(f)}>{f}</button>
            ))}
          </div>
        )}
      </div>
      <div className="chat-dock">
        <div className={`chat-ctx ${!textReady ? 'chat-ctx-loading' : ''}`}>{ctxLine}</div>
        {error && <div role="alert" className="alert-banner">{error}</div>}
        <div className="chip-row">
          {QUICK_PROMPTS.map(p => (
            <button key={p.label} className="chip" onClick={() => send(p.prompt)} disabled={busy || !textReady}>{p.label}</button>
          ))}
        </div>
        <div className="dock-actions">
          <button onClick={clearChat} disabled={busy || history.length === 0}>清空对话</button>
        </div>
        <div className="input-row">
          <textarea
            ref={taRef}
            className="chat-textarea"
            placeholder="输入问题…"
            value={input}
            rows={1}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
          />
          <label className="deepthink-label">
            <input type="checkbox" checked={deepThink} onChange={e => setDeepThink(e.target.checked)} />深思
          </label>
          {busy ? (
            <button className="btn-primary" onClick={() => window.api.stopChat()}>停止</button>
          ) : (
            <button className="btn-primary" onClick={() => send()} disabled={!textReady}>发送</button>
          )}
        </div>
      </div>
    </div>
  )
}
