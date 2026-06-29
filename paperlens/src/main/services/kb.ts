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

// 带 [第N页] 标记的正文 → 按页切段后逐页 chunk，每块标注来源页码。
// 不让 chunk 跨页，保证「来源片段」跳转页码唯一、准确。无标记时退化为页码 0。
export function chunkPagedText(pagedText: string, size = 1200, overlap = 150): PagedChunk[] {
  const matches = [...pagedText.matchAll(/\[第(\d+)页\]\n?/g)]
  if (matches.length === 0) return chunkText(pagedText, size, overlap).map(text => ({ text, page: 0 }))
  const out: PagedChunk[] = []
  for (let i = 0; i < matches.length; i++) {
    const page = Number(matches[i][1])
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? pagedText.length) : pagedText.length
    const body = pagedText.slice(start, end)
    for (const text of chunkText(body, size, overlap)) out.push({ text, page })
  }
  return out
}

export function buildQueryExpansionMessages(question: string, history?: ChatMessage[]): ChatMessage[] {
  let system =
    '你是文献检索助手。把用户问题改写成 3-6 个适合全文检索的关键词/短语，' +
    '必须中英文混合（论文多为英文，需包含英文术语）。' +
    '只输出一个 JSON 字符串数组，例如 ["RLHF","人类反馈","reward model"]，不要任何其他文字。'
  if (history && history.length > 0) {
    // 多轮追问常带指代（「它」「这种方法」），附最近 2 轮摘录帮模型还原具体名词
    const excerpt = history
      .slice(-4)
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n')
    system +=
      '\n\n对话摘录（最近的上下文）：\n' + excerpt +
      '\n\n检索词要解析指代（如「它」「这种方法」），结合摘录替换成具体名词/术语。'
  }
  return [
    { role: 'system', content: system },
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
  pageIndex: number
}

// 每个 chunk 带来源页码（1 基；0 = 无页信息）。供 KB 来源跳转到原文页。
export type PagedChunk = { text: string; page: number }

export function insertChunks(db: DatabaseType.Database, paperKey: string, paperTitle: string, chunks: PagedChunk[]): void {
  const del = db.prepare('DELETE FROM chunks WHERE paper_key = ?')
  const ins = db.prepare('INSERT INTO chunks (paper_key, paper_title, seq, text, page_index) VALUES (?,?,?,?,?)')
  // 删除与插入同事务：重建索引中途失败时回滚，不会把论文「越索引越没了」
  const replace = db.transaction((cs: PagedChunk[]) => {
    del.run(paperKey)
    cs.forEach((c, i) => ins.run(paperKey, paperTitle, i, c.text, c.page))
  })
  replace(chunks)
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
  const add = (row: { id: number; paper_key: string; paper_title: string; text: string; page_index: number }, rank: number) => {
    const cur = acc.get(row.id)
    if (cur) {
      cur.hitCount += 1
      cur.bestRank = Math.min(cur.bestRank, rank)
    } else {
      acc.set(row.id, {
        id: row.id, paperKey: row.paper_key, paperTitle: row.paper_title, text: row.text, pageIndex: row.page_index ?? 0,
        hitCount: 1, bestRank: rank,
      })
    }
  }
  for (const term of terms) {
    const t = term.trim()
    if (!t) continue
    if (t.length >= 3) {
      const rows = db.prepare(
        `SELECT c.id, c.paper_key, c.paper_title, c.text, c.page_index, bm25(chunks_fts) AS rank
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`
      ).all(`"${t.replaceAll('"', '""')}"`, k) as Array<{ id: number; paper_key: string; paper_title: string; text: string; page_index: number; rank: number }>
      rows.forEach(r => add(r, r.rank))
    } else {
      const rows = db.prepare(
        `SELECT id, paper_key, paper_title, text, page_index FROM chunks WHERE text LIKE ? LIMIT ?`
      ).all(`%${t}%`, k) as Array<{ id: number; paper_key: string; paper_title: string; text: string; page_index: number }>
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

// 按论文聚合检索命中：来源编号以论文为单位，与 UI 的论文 chips 一一对应
export interface KbSource {
  paperKey: string
  paperTitle: string
  chunks: PagedChunk[]
}

const MAX_CHUNKS_PER_SOURCE = 3

export function groupHitsToSources(hits: ChunkHit[]): KbSource[] {
  const byKey = new Map<string, KbSource>()
  const out: KbSource[] = []
  for (const h of hits) {
    let src = byKey.get(h.paperKey)
    if (!src) {
      // 首个命中决定论文顺序（hits 已按相关度排序）
      src = { paperKey: h.paperKey, paperTitle: h.paperTitle, chunks: [] }
      byKey.set(h.paperKey, src)
      out.push(src)
    }
    if (src.chunks.length < MAX_CHUNKS_PER_SOURCE) src.chunks.push({ text: h.text, page: h.pageIndex })
  }
  return out
}

export function buildKbAnswerMessages(question: string, sources: KbSource[], history?: ChatMessage[]): ChatMessage[] {
  // 来源按论文编号（同论文多段合并），保证答案里的 [来源N] 与界面第 N 个论文 chip 严格一致
  const sourceText = sources
    .map((s, i) => `【来源${i + 1} · ${s.paperTitle}】\n${s.chunks.map(c => c.text).join('\n---\n')}`)
    .join('\n\n')
  return [
    {
      role: 'system',
      content:
        '你是论文知识库助手。只依据下面提供的论文片段回答用户问题；' +
        '引用某片段的内容时在句末标注 [来源N]（即来源标注）；' +
        `来源共 ${sources.length} 个，引用标注 [来源N] 必须使用这些编号，不要编造编号；` +
        '如果片段中没有提及答案，明确说明「库内片段没有提及」，不要编造。\n\n' +
        sourceText,
    },
    ...(history ?? []),
    { role: 'user', content: question },
  ]
}

// 全库问答的追问建议（区别于单篇 buildFollowupMessages：不绑定单篇标题，强调跨论文）
export function buildKbFollowupMessages(lastAnswer: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是论文知识库助手。请基于刚才的全库问答回答，生成 3 个用户可能想继续追问的简短问题' +
        '（每个不超过 20 字，可涉及对比多篇、追细节、找相关工作）；' +
        '只输出一个 JSON 字符串数组，例如 ["还有哪些论文用了类似方法？","它们的效果对比如何？","有公开实现吗？"]，不要任何其他文字。',
    },
    { role: 'user', content: lastAnswer.slice(0, 2_000) },
  ]
}

// 综述 map 阶段取材：论文开头的 chunk（摘要/引言）最能代表全文
export function representativeChunks(db: DatabaseType.Database, paperKey: string, k = 3): string[] {
  const rows = db.prepare(
    'SELECT text FROM chunks WHERE paper_key = ? ORDER BY seq ASC LIMIT ?'
  ).all(paperKey, k) as Array<{ text: string }>
  return rows.map(r => r.text)
}

// 综述 map 阶段：单篇论文片段 → 3-5 条核心要点
export function buildReviewMapMessages(paperTitle: string, chunks: string[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是文献综述助手。基于下面提供的论文片段，提炼该论文的 3-5 条核心要点，' +
        '需覆盖方法、结论、局限。用 Markdown 无序列表输出，总长不超过 300 字，' +
        '忠于原文，不要编造片段中没有的内容。',
    },
    { role: 'user', content: `标题：${paperTitle}\n\n${chunks.join('\n\n')}` },
  ]
}

// 综述 reduce 阶段：多篇要点 → 结构化中文综述（四节固定结构）
export function buildReviewReduceMessages(
  scopeLabel: string,
  items: Array<{ title: string; points: string }>
): ChatMessage[] {
  const body = items.map(it => `### ${it.title}\n${it.points}`).join('\n\n')
  return [
    {
      role: 'system',
      content:
        '你是文献综述助手。基于下面多篇论文的要点，撰写一篇结构化的中文文献综述。' +
        '综述必须包含以下四节（用这些二级标题，缺一不可）：' +
        '## 主题分组、## 方法对照、## 主要分歧、## 开放问题。' +
        '引用论文时使用论文标题；忠于各论文要点，不要编造要点中没有的内容。',
    },
    { role: 'user', content: `综述范围：${scopeLabel}\n\n${body}` },
  ]
}

// rerank：让 LLM 给每个检索片段与问题的相关性打分，过滤 bm25 的误命中
export function buildRerankMessages(question: string, hits: ChunkHit[]): ChatMessage[] {
  const list = hits
    .map((h, i) => `[${i + 1}] ${h.text.slice(0, 500)}`)
    .join('\n\n')
  return [
    {
      role: 'system',
      content:
        '你是检索结果重排器。为每个片段与问题的相关性打分 0-3（3=直接回答，0=无关）。' +
        `只输出一个 JSON 数字数组，长度必须为 ${hits.length}，按片段编号顺序排列，不要任何其他文字。`,
    },
    { role: 'user', content: `问题：${question}\n\n片段：\n${list}` },
  ]
}

export function parseRerankScores(text: string, count: number): number[] | null {
  const m = text.match(/\[[\s\S]*?\]/)
  if (!m) return null
  try {
    const arr = JSON.parse(m[0]) as unknown
    if (!Array.isArray(arr) || arr.length !== count) return null
    const out: number[] = []
    for (const v of arr) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return null
      out.push(Math.min(3, Math.max(0, v)))
    }
    return out
  } catch {
    return null
  }
}
