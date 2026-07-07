import type DatabaseType from 'better-sqlite3'

export interface ChatRecord {
  id: number
  paperKey: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string | null
  createdAt: number
}

interface ChatRow {
  id: number; paper_key: string; role: string
  content: string; reasoning: string | null; created_at: number
}

function rowToRecord(r: ChatRow): ChatRecord {
  return {
    id: r.id, paperKey: r.paper_key, role: r.role as ChatRecord['role'],
    content: r.content, reasoning: r.reasoning, createdAt: r.created_at,
  }
}

export function createChatRepo(db: DatabaseType.Database, now: () => number = () => Date.now()) {
  function append(m: {
    paperKey: string; role: 'user' | 'assistant'; content: string; reasoning?: string | null
  }): ChatRecord {
    const record = {
      paperKey: m.paperKey, role: m.role, content: m.content,
      reasoning: m.reasoning ?? null, createdAt: now(),
    }
    const info = db.prepare(
      `INSERT INTO chat_messages (paper_key, role, content, reasoning, created_at)
       VALUES (@paperKey, @role, @content, @reasoning, @createdAt)`
    ).run(record)
    return { id: Number(info.lastInsertRowid), ...record }
  }

  function listByPaper(paperKey: string): ChatRecord[] {
    const rows = db.prepare(
      'SELECT * FROM chat_messages WHERE paper_key = ? ORDER BY id ASC'
    ).all(paperKey) as ChatRow[]
    return rows.map(rowToRecord)
  }

  function clearByPaper(paperKey: string): void {
    db.prepare('DELETE FROM chat_messages WHERE paper_key = ?').run(paperKey)
  }

  // 用给定消息整体替换某论文的对话（事务内先清后写）。
  // 「重新生成」需要丢弃旧回答及其后的全部记录，单条 append 做不到，故整体重写。
  function replaceAll(
    paperKey: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string; reasoning?: string | null }>,
  ): void {
    const ins = db.prepare(
      `INSERT INTO chat_messages (paper_key, role, content, reasoning, created_at)
       VALUES (@paperKey, @role, @content, @reasoning, @createdAt)`
    )
    const tx = db.transaction((ms: typeof messages) => {
      db.prepare('DELETE FROM chat_messages WHERE paper_key = ?').run(paperKey)
      for (const m of ms) {
        ins.run({ paperKey, role: m.role, content: m.content, reasoning: m.reasoning ?? null, createdAt: now() })
      }
    })
    tx(messages)
  }

  return { append, listByPaper, clearByPaper, replaceAll }
}
