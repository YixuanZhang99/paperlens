import { useEffect, useState } from 'react'
import type { Note, Paper } from '@shared/types'

export function ReaderView({ paper }: { paper: Paper | null }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [syncing, setSyncing] = useState<string | null>(null)

  useEffect(() => {
    if (paper) window.api.listNotes(paper.key).then(setNotes)
    else setNotes([])
  }, [paper?.key])

  if (!paper) return <div style={{ padding: 12, color: '#888' }}>从左侧选择论文</div>

  async function sync(noteId: string) {
    setSyncing(noteId)
    try {
      await window.api.syncNote({ noteId, paper: paper! })
      setNotes(await window.api.listNotes(paper!.key))
    } finally { setSyncing(null) }
  }

  return (
    <div style={{ padding: 16 }}>
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
  )
}
