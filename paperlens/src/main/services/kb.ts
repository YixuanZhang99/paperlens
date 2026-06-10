import type DatabaseType from 'better-sqlite3'
import type { ChatMessage } from '@shared/types'

// 论文全文切块：固定窗口 + 重叠，保证检索段落上下文完整
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const t = text.trim()
  if (!t) return []
  const step = Math.max(1, size - overlap)
  const out: string[] = []
  for (let i = 0; i < t.length; i += step) {
    out.push(t.slice(i, i + size))
    if (i + size >= t.length) break
  }
  return out
}

export function buildQueryExpansionMessages(question: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是文献检索助手。把用户问题改写成 3-6 个适合全文检索的关键词/短语，' +
        '必须中英文混合（论文多为英文，需包含英文术语）。' +
        '只输出一个 JSON 字符串数组，例如 ["RLHF","人类反馈","reward model"]，不要任何其他文字。',
    },
    { role: 'user', content: question },
  ]
}

export function parseQueryTerms(text: string): string[] {
  const m = text.match(/\[[\s\S]*?\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as unknown
    if (!Array.isArray(arr)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const t of arr) {
      if (typeof t !== 'string') continue
      const s = t.trim()
      if (s.length < 2 || seen.has(s)) continue
      seen.add(s)
      out.push(s)
      if (out.length >= 6) break
    }
    return out
  } catch {
    return []
  }
}

export interface ChunkHit {
  id: number
  paperKey: string
  paperTitle: string
  text: string
}

export function insertChunks(db: DatabaseType.Database, paperKey: string, paperTitle: string, chunks: string[]): void {
  db.prepare('DELETE FROM chunks WHERE paper_key = ?').run(paperKey)
  const ins = db.prepare('INSERT INTO chunks (paper_key, paper_title, seq, text) VALUES (?,?,?,?)')
  const all = db.transaction((cs: string[]) => {
    cs.forEach((c, i) => ins.run(paperKey, paperTitle, i, c))
  })
  all(chunks)
}

export function indexedPaperKeys(db: DatabaseType.Database): Set<string> {
  const rows = db.prepare('SELECT DISTINCT paper_key AS k FROM chunks').all() as Array<{ k: string }>
  return new Set(rows.map(r => r.k))
}

export function kbStatus(db: DatabaseType.Database): { indexedPapers: number; totalChunks: number } {
  const r = db.prepare('SELECT COUNT(DISTINCT paper_key) AS p, COUNT(*) AS c FROM chunks').get() as { p: number; c: number }
  return { indexedPapers: r.p, totalChunks: r.c }
}

// 检索：≥3 字符词走 FTS5 MATCH（bm25 排序），更短词 LIKE 兜底；
// 合并去重后按「命中词数 desc，bm25 asc」排序取 top-k。
export function searchChunks(db: DatabaseType.Database, terms: string[], k = 8): ChunkHit[] {
  type Acc = ChunkHit & { hitCount: number; bestRank: number }
  const acc = new Map<number, Acc>()
  const add = (row: { id: number; paper_key: string; paper_title: string; text: string }, rank: number) => {
    const cur = acc.get(row.id)
    if (cur) {
      cur.hitCount += 1
      cur.bestRank = Math.min(cur.bestRank, rank)
    } else {
      acc.set(row.id, {
        id: row.id, paperKey: row.paper_key, paperTitle: row.paper_title, text: row.text,
        hitCount: 1, bestRank: rank,
      })
    }
  }
  for (const term of terms) {
    const t = term.trim()
    if (!t) continue
    if (t.length >= 3) {
      const rows = db.prepare(
        `SELECT c.id, c.paper_key, c.paper_title, c.text, bm25(chunks_fts) AS rank
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`
      ).all(`"${t.replaceAll('"', '""')}"`, k) as Array<{ id: number; paper_key: string; paper_title: string; text: string; rank: number }>
      rows.forEach(r => add(r, r.rank))
    } else {
      const rows = db.prepare(
        `SELECT id, paper_key, paper_title, text FROM chunks WHERE text LIKE ? LIMIT ?`
      ).all(`%${t}%`, k) as Array<{ id: number; paper_key: string; paper_title: string; text: string }>
      rows.forEach(r => add(r, 0))
    }
  }
  return [...acc.values()]
    .sort((a, b) => b.hitCount - a.hitCount || a.bestRank - b.bestRank)
    .slice(0, k)
    .map(({ hitCount: _h, bestRank: _r, ...hit }) => hit)
}

export interface KbHit {
  paperTitle: string
  text: string
}

export function buildKbAnswerMessages(question: string, hits: KbHit[]): ChatMessage[] {
  const sources = hits
    .map((h, i) => `【来源${i + 1} · ${h.paperTitle}】\n${h.text}`)
    .join('\n\n')
  return [
    {
      role: 'system',
      content:
        '你是论文知识库助手。只依据下面提供的论文片段回答用户问题；' +
        '引用某片段的内容时在句末标注 [来源N]（即来源标注）；' +
        '如果片段中没有提及答案，明确说明「库内片段没有提及」，不要编造。\n\n' +
        sources,
    },
    { role: 'user', content: question },
  ]
}
