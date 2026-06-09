import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Paper } from '@shared/types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function ChatView({ paper }: { paper: Paper | null }) {
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paperText = useRef('')

  useEffect(() => {
    setHistory([])
    setError(null)
    paperText.current = ''
    if (paper) window.api.getPaperText(paper).then(t => { paperText.current = t })
  }, [paper?.key])

  if (!paper) return <div style={{ padding: 12, color: '#888' }}>请选择一篇论文开始对话</div>

  async function send() {
    if (!input.trim() || busy) return
    setError(null)
    const userMsg: ChatMessage = { role: 'user', content: input }
    const priorHistory = history
    setHistory([...priorHistory, userMsg, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)
    try {
      await window.api.streamChat(
        { paper: paper!, paperText: paperText.current, history: priorHistory, input: userMsg.content },
        (delta) => {
          setHistory(h => {
            const copy = h.slice()
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { role: 'assistant', content: last.content + delta }
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
    if (last && last.content) await window.api.addNote({ paperKey: paper!.key, content: last.content, tags: [] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {history.map((m, i) => (
          <div key={i} style={{ margin: '8px 0', textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: 8, background: m.role === 'user' ? '#def' : '#f0f0f0', whiteSpace: 'pre-wrap' }}>
              {m.content || (busy && m.role === 'assistant' ? '…' : '')}
            </span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #ddd', padding: 8 }}>
        {error && <div role="alert" style={{ color: 'crimson', fontSize: 13, marginBottom: 6 }}>{error}</div>}
        <button onClick={saveLastAsNote} disabled={busy || !history.some(m => m.role === 'assistant' && m.content)}>存为笔记</button>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            placeholder="输入问题…" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send() }}
            style={{ flex: 1 }} />
          <button onClick={send} disabled={busy}>发送</button>
        </div>
      </div>
    </div>
  )
}
