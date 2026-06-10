import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Paper } from '@shared/types'

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

export function ChatView({ paper, onNoteSaved }: { paper: Paper | null; onNoteSaved?: () => void }) {
  const [history, setHistory] = useState<Bubble[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [deepThink, setDeepThink] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paperText = useRef('')

  useEffect(() => {
    setHistory([])
    setError(null)
    paperText.current = ''
    if (paper) window.api.getPaperText(paper).then(t => { paperText.current = t })
  }, [paper?.key])

  if (!paper) return <div className="placeholder-pane">请选择一篇论文开始对话</div>

  async function send(text?: string) {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setError(null)
    const userMsg: Bubble = { role: 'user', content: q }
    const priorHistory = history
    setHistory([...priorHistory, userMsg, { role: 'assistant', content: '' }])
    if (text === undefined) setInput('')
    setBusy(true)
    try {
      await window.api.streamChat(
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
              copy[copy.length - 1] = kind === 'reasoning'
                ? { ...last, reasoning: (last.reasoning ?? '') + delta }
                : { ...last, content: last.content + delta }
            }
            return copy
          })
        },
      )
    } catch (e) {
      setError('AI 回复失败：' + errMsg(e))
      setHistory(h => {
        const last = h[h.length - 1]
        return last && last.role === 'assistant' && !last.content ? h.slice(0, -1) : h
      })
    } finally {
      setBusy(false)
    }
  }

  async function saveLastAsNote() {
    const last = [...history].reverse().find(m => m.role === 'assistant')
    if (last && last.content) {
      await window.api.addNote({ paperKey: paper!.key, content: last.content, tags: [], autoTag: true })
      onNoteSaved?.()
    }
  }

  return (
    <div className="chat">
      <div className="chat-scroll">
        {history.map((m, i) => (
          <div key={i} className={'bubble-row ' + (m.role === 'user' ? 'user' : 'assistant')}>
            {m.reasoning && (
              <div className="reasoning-block">{m.reasoning}</div>
            )}
            <span className={'bubble ' + (m.role === 'user' ? 'user' : 'assistant')}>
              {m.content || (busy && m.role === 'assistant' ? '…' : '')}
            </span>
          </div>
        ))}
      </div>
      <div className="chat-dock">
        {error && <div role="alert" className="alert-banner">{error}</div>}
        <div className="chip-row">
          {QUICK_PROMPTS.map(p => (
            <button key={p.label} className="chip" onClick={() => send(p.prompt)} disabled={busy}>{p.label}</button>
          ))}
        </div>
        <div className="dock-actions">
          <button onClick={saveLastAsNote} disabled={busy || !history.some(m => m.role === 'assistant' && m.content)}>存为笔记</button>
        </div>
        <div className="input-row">
          <input
            placeholder="输入问题…" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send() }} />
          <label className="deepthink-label">
            <input type="checkbox" checked={deepThink} onChange={e => setDeepThink(e.target.checked)} />深思
          </label>
          <button className="btn-primary" onClick={() => send()} disabled={busy}>发送</button>
        </div>
      </div>
    </div>
  )
}
