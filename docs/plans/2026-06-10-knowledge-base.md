# PaperLens 知识库 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 知识库页面 = 全库 AI 问答（FTS5 检索 + 双语扩写 + 来源标注）+ 跨论文笔记聚合浏览 + 全库自动索引（纯本地零 API 费）。

**Architecture:** 已批准设计 `docs/plans/2026-06-10-knowledge-base-design.md`（K-A 方案）。新增纯服务模块 `kb.ts`（切块/扩写与作答 prompt/检索词解析/FTS 检索，全部 TDD），migrate v2 加 `chunks`+`chunks_fts`（trigram，external-content 触发器同步），IPC 四通道（kb:index 带进度事件 / kb:status / kb:ask 带 kb:token 流式 / notes:listAll），`KnowledgeView` 近全屏覆盖层（问答 + 笔记/索引 Tab）。索引复用 `getPaperTextCached`（本地读+pdfjs）。

**Tech Stack:** 现有栈，零新依赖（FTS5 已实测：≥3 字符 MATCH/bm25，2 字中文 LIKE 兜底）。

**基线：** 分支 `feature/knowledge-base`（HEAD `815b554`），78 passed + 2 skipped，tsc 0。注意 better-sqlite3 ABI 舞步：跑全量测试前 `npm rebuild better-sqlite3`（系统 Node），跑应用/driver 前 `npx @electron/rebuild -f -w better-sqlite3 -v 32.3.3`。

**计数预期：** KB-1 后 80，KB-2 后 83，KB-3 后 88，KB-4 后 92，KB-5 后 93，KB-7 后 96，KB-8 后 97（+2 skipped）。

---

### Task KB-1: migrate v2 — chunks + FTS5 + 同步触发器

**Files:**
- Modify: `paperlens/src/main/services/db.ts`（migrate 函数末尾追加 exec）
- Test: `paperlens/tests/main/db.test.ts`（追加 2 测）

**Step 1: 失败测试** —— 追加到 `describe('db.migrate', ...)`：
```ts
  it('creates chunks table and chunks_fts with sync triggers', () => {
    const db = new Database(':memory:')
    migrate(db)
    db.prepare('INSERT INTO chunks (paper_key, paper_title, seq, text) VALUES (?,?,?,?)')
      .run('P1', '论文一', 0, '中期训练是预训练与微调之间的关键阶段')
    const hit = db.prepare(
      `SELECT c.paper_key FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH ?`
    ).all('"中期训练"')
    expect(hit).toEqual([{ paper_key: 'P1' }])
  })

  it('fts index follows chunk deletion', () => {
    const db = new Database(':memory:')
    migrate(db)
    db.prepare('INSERT INTO chunks (paper_key, paper_title, seq, text) VALUES (?,?,?,?)')
      .run('P1', 'T', 0, 'transformer attention mechanism')
    db.prepare('DELETE FROM chunks WHERE paper_key = ?').run('P1')
    const hit = db.prepare(`SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?`).all('attention')
    expect(hit).toEqual([])
  })
```

**Step 2: 红** `cd /Users/zhangyixuan06/work/paperlens && npx vitest run tests/main/db.test.ts` → 2 新测 FAIL（no such table: chunks）。

**Step 3: 实现** —— `db.ts` 的 `db.exec` 末尾（pdf_cache 之后）追加：
```sql
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      paper_key TEXT NOT NULL,
      paper_title TEXT NOT NULL,
      seq INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_paper ON chunks(paper_key);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text, content='chunks', content_rowid='id', tokenize='trigram'
    );
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
    END;
```

**Step 4: 绿** db.test 4 passed；`npx tsc --noEmit` 0；全量 **80 passed + 2 skipped**（需系统 ABI）。

**Step 5: Commit** `git add paperlens/src/main/services/db.ts paperlens/tests/main/db.test.ts && git commit -m "feat: chunks + fts5 trigram index with sync triggers (kb migrate v2)"`

---

### Task KB-2: kb.ts — chunkText（纯函数）

**Files:**
- Create: `paperlens/src/main/services/kb.ts`
- Test: `paperlens/tests/main/kb-chunk.test.ts`（新建）

**Step 1: 失败测试**：
```ts
import { describe, it, expect } from 'vitest'
import { chunkText } from '../../src/main/services/kb'

describe('chunkText', () => {
  it('splits long text into overlapping chunks of the given size', () => {
    const text = 'A'.repeat(3000)
    const chunks = chunkText(text, 1200, 150)
    expect(chunks.length).toBe(3) // 步长 1050：0-1200, 1050-2250, 2100-3000
    expect(chunks[0]).toHaveLength(1200)
    expect(chunks[1].slice(0, 150)).toBe(chunks[0].slice(-150)) // 重叠区一致
    expect(chunks.at(-1)!.length).toBeLessThanOrEqual(1200)
  })

  it('returns single chunk for short text and [] for blank', () => {
    expect(chunkText('短文本', 1200, 150)).toEqual(['短文本'])
    expect(chunkText('   ', 1200, 150)).toEqual([])
  })

  it('uses defaults size=1200 overlap=150', () => {
    expect(chunkText('B'.repeat(1250))[0]).toHaveLength(1200)
  })
})
```

**Step 2: 红**（模块不存在）。

**Step 3: 实现** —— 新建 `kb.ts`：
```ts
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
```
（`ChatMessage` import 供后续任务使用；若 tsc 报 unused，本任务先不加 import，KB-3 再加。）

**Step 4: 绿** 3 passed；tsc 0。

**Step 5: Commit** `git commit -m "feat: kb chunkText (overlapping windows)"`

---

### Task KB-3: kb.ts — 扩写/作答 prompt + parseQueryTerms（纯函数）

**Files:**
- Modify: `paperlens/src/main/services/kb.ts`（追加）
- Test: `paperlens/tests/main/kb-prompts.test.ts`（新建）

**Step 1: 失败测试**：
```ts
import { describe, it, expect } from 'vitest'
import { buildQueryExpansionMessages, parseQueryTerms, buildKbAnswerMessages } from '../../src/main/services/kb'

describe('buildQueryExpansionMessages', () => {
  it('asks for a bilingual JSON keyword array', () => {
    const msgs = buildQueryExpansionMessages('哪些论文讨论了人类反馈强化学习？')
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('JSON')
    expect(msgs[0].content).toMatch(/英文|English/)
    expect(msgs[1]).toEqual({ role: 'user', content: '哪些论文讨论了人类反馈强化学习？' })
  })
})

describe('parseQueryTerms', () => {
  it('parses terms from plain or fenced arrays, trims, dedups, caps at 6', () => {
    expect(parseQueryTerms('["RLHF","人类反馈","reinforcement learning"]'))
      .toEqual(['RLHF', '人类反馈', 'reinforcement learning'])
    expect(parseQueryTerms('```json\n["a1","b2","a1","c3","d4","e5","f6","g7"]\n```'))
      .toEqual(['a1', 'b2', 'c3', 'd4', 'e5', 'f6'])
  })
  it('drops non-strings/too-short and returns [] on garbage', () => {
    expect(parseQueryTerms('[1, "x", "对齐", ""]')).toEqual(['对齐'])
    expect(parseQueryTerms('没有数组')).toEqual([])
  })
})

describe('buildKbAnswerMessages', () => {
  it('embeds numbered sources and demands citation + honesty', () => {
    const msgs = buildKbAnswerMessages('RLHF 是什么？', [
      { paperTitle: '论文A', text: '片段一' },
      { paperTitle: '论文B', text: '片段二' },
    ])
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('【来源1 · 论文A】')
    expect(msgs[0].content).toContain('片段二')
    expect(msgs[0].content).toMatch(/\[来源N\]|来源标注/)
    expect(msgs[0].content).toMatch(/不知道|无法回答|没有提及/)
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'RLHF 是什么？' })
  })
})
```

**Step 2: 红**。

**Step 3: 实现** —— `kb.ts` 追加（顶部补 `import type { ChatMessage } from '@shared/types'`）：
```ts
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
```

**Step 4: 绿** 5 passed；tsc 0。

**Step 5: Commit** `git commit -m "feat: kb query-expansion & answer prompts + parseQueryTerms"`

---

### Task KB-4: kb.ts — insertChunks / searchChunks / kbStatus（内存库 TDD）

**Files:**
- Modify: `paperlens/src/main/services/kb.ts`（追加，顶部加 `import type DatabaseType from 'better-sqlite3'`）
- Test: `paperlens/tests/main/kb-search.test.ts`（新建）

**Step 1: 失败测试**：
```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { insertChunks, searchChunks, kbStatus, indexedPaperKeys } from '../../src/main/services/kb'

function seeded() {
  const db = new Database(':memory:')
  migrate(db)
  insertChunks(db, 'P1', 'RLHF 论文', ['reward model 与 RLHF 对齐训练', '第二段讲 PPO 算法细节'])
  insertChunks(db, 'P2', '蒸馏论文', ['knowledge distillation 知识蒸馏方法'])
  return db
}

describe('insertChunks / indexedPaperKeys / kbStatus', () => {
  it('stores chunks with seq and reports status', () => {
    const db = seeded()
    expect(indexedPaperKeys(db)).toEqual(new Set(['P1', 'P2']))
    expect(kbStatus(db)).toEqual({ indexedPapers: 2, totalChunks: 3 })
  })
  it('re-inserting a paper replaces its old chunks', () => {
    const db = seeded()
    insertChunks(db, 'P1', 'RLHF 论文', ['新版本片段'])
    expect(kbStatus(db).totalChunks).toBe(2)
    expect(searchChunks(db, ['PPO'])).toHaveLength(0) // 旧片段已被替换
  })
})

describe('searchChunks', () => {
  it('finds via MATCH for >=3-char terms ranked, with paper info', () => {
    const hits = searchChunks(db => db, [] as never) // placeholder 防误用——真实断言在下面
  })
})
```
（注意：最后一个空壳删除——实际写为下列三测）
```ts
describe('searchChunks', () => {
  it('MATCH finds long terms and returns paper info', () => {
    const hits = searchChunks(seeded(), ['RLHF'])
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0]).toMatchObject({ paperKey: 'P1', paperTitle: 'RLHF 论文' })
    expect(hits[0].text).toContain('RLHF')
  })
  it('2-char CJK terms fall back to LIKE', () => {
    const hits = searchChunks(seeded(), ['蒸馏'])
    expect(hits).toHaveLength(1)
    expect(hits[0].paperKey).toBe('P2')
  })
  it('multi-term hits merge & rank by term coverage, capped at k', () => {
    const hits = searchChunks(seeded(), ['RLHF', 'PPO', '蒸馏'], 2)
    expect(hits).toHaveLength(2)
    // P1 第一段命中 RLHF、第二段命中 PPO、P2 命中 蒸馏——top2 中必含 P1 的段
    expect(hits.some(h => h.paperKey === 'P1')).toBe(true)
  })
})
```

**Step 2: 红**。

**Step 3: 实现** —— `kb.ts` 追加：
```ts
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

// 检索：≥3 字符词走 FTS5 MATCH（bm25 排序），更短的中文词 LIKE 兜底；
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
```

**Step 4: 绿** kb-search 5 passed；tsc 0；全量 **92 passed + 2 skipped**。

**Step 5: Commit** `git commit -m "feat: kb chunk store + hybrid fts/like search + status"`

---

### Task KB-5: notes-repo.listAll

**Files:**
- Modify: `paperlens/src/main/services/notes-repo.ts`
- Test: `paperlens/tests/main/notes-repo.test.ts`（追加 1 测）

**Step 1: 失败测试**：
```ts
  it('lists all notes across papers, newest first', () => {
    const r = repo()
    r.add({ paperKey: 'P1', content: '一', tags: [] })
    r.add({ paperKey: 'P2', content: '二', tags: ['x'] })
    const all = r.listAll()
    expect(all.map(n => n.paperKey)).toEqual(['P2', 'P1']) // created_at 相同 → id 倒序兜底
    expect(all[0].tags).toEqual(['x'])
  })
```
（夹具 `now` 恒定 → 按 `created_at DESC, id DESC` 排序保证 P2 在前。）

**Step 2: 红。Step 3: 实现** —— notes-repo 追加并导出：
```ts
  function listAll(): Note[] {
    const rows = db.prepare('SELECT * FROM notes ORDER BY created_at DESC, id DESC').all() as NoteRow[]
    return rows.map(rowToNote)
  }
```
`return { add, listByPaper, markSynced, listAll }`

**Step 4: 绿**（93+2）。**Step 5: Commit** `git commit -m "feat: notes listAll (newest first)"`

---

### Task KB-6: IPC + preload（胶水，tsc+build 验收）

**Files:**
- Modify: `paperlens/src/main/ipc.ts`
- Modify: `paperlens/src/preload/index.ts`

**Step 1: ipc.ts** —— import 行加：
```ts
import { chunkText, buildQueryExpansionMessages, parseQueryTerms, buildKbAnswerMessages, insertChunks, searchChunks, kbStatus, indexedPaperKeys } from './services/kb'
```
`registerIpc` 内（notes:sync 之后）追加：
```ts
  ipcMain.handle('notes:listAll', () => c.notesRepo.listAll())

  ipcMain.handle('kb:status', async () => {
    const total = (await c.zotero().listPapers()).length
    return { ...kbStatus(c.db), totalPapers: total }
  })

  // 全库索引：逐篇抽取（本地）→ 切块入库；progress 事件推送；单篇失败跳过
  ipcMain.handle('kb:index', async (event) => {
    const papers = await c.zotero().listPapers()
    const done = indexedPaperKeys(c.db)
    let indexed = 0, skipped = 0, processed = 0
    for (const p of papers) {
      processed++
      if (done.has(p.key)) { event.sender.send('kb:progress', processed, papers.length, p.title); continue }
      try {
        const text = await getPaperTextCached(c, p)
        if (text) { insertChunks(c.db, p.key, p.title, chunkText(text)); indexed++ }
        else skipped++
      } catch { skipped++ }
      event.sender.send('kb:progress', processed, papers.length, p.title)
    }
    return { indexed, skipped, ...kbStatus(c.db) }
  })

  ipcMain.handle('kb:ask', async (event, question: string) => {
    let terms: string[] = []
    try { terms = parseQueryTerms(await c.ai().complete(buildQueryExpansionMessages(question))) } catch { /* 扩写失败回退 */ }
    if (terms.length === 0) terms = [question]
    const hits = searchChunks(c.db, terms)
    if (hits.length === 0) throw new Error('知识库中没有检索到相关内容，请先更新索引或换个问法')
    const messages = buildKbAnswerMessages(question, hits.map(h => ({ paperTitle: h.paperTitle, text: h.text })))
    const answer = await c.ai().stream(messages, (delta, kind) => event.sender.send('kb:token', delta, kind))
    const seen = new Set<string>()
    const sources = hits.filter(h => !seen.has(h.paperKey) && seen.add(h.paperKey))
      .map(h => ({ paperKey: h.paperKey, title: h.paperTitle }))
    return { answer, sources }
  })
```

**Step 2: preload** —— api 对象追加：
```ts
  listAllNotes: (): Promise<Note[]> => ipcRenderer.invoke('notes:listAll'),
  kbStatus: (): Promise<{ indexedPapers: number; totalChunks: number; totalPapers: number }> =>
    ipcRenderer.invoke('kb:status'),
  kbIndex: (onProgress: (done: number, total: number, title: string) => void): Promise<{ indexed: number; skipped: number }> => {
    const listener = (_e: Electron.IpcRendererEvent, done: number, total: number, title: string) => onProgress(done, total, title)
    ipcRenderer.on('kb:progress', listener)
    return ipcRenderer.invoke('kb:index').finally(() => ipcRenderer.removeListener('kb:progress', listener))
  },
  kbAsk: (
    question: string,
    onToken: (delta: string, kind: 'content' | 'reasoning') => void,
  ): Promise<{ answer: string; sources: Array<{ paperKey: string; title: string }> }> => {
    const listener = (_e: Electron.IpcRendererEvent, delta: string, kind: 'content' | 'reasoning') => onToken(delta, kind)
    ipcRenderer.on('kb:token', listener)
    return ipcRenderer.invoke('kb:ask', question).finally(() => ipcRenderer.removeListener('kb:token', listener))
  },
```

**Step 3: 验证** tsc 0；renderer 测试不回归；`npm run build` 成功。通道名核对表：`notes:listAll / kb:status / kb:index / kb:progress / kb:ask / kb:token` 主进程与 preload 必须逐字一致。

**Step 4: Commit** `git commit -m "feat: kb ipc (index/status/ask) + preload bridge"`

---

### Task KB-7: KnowledgeView（RTL TDD）

**Files:**
- Create: `paperlens/src/renderer/components/KnowledgeView.tsx`
- Modify: `paperlens/src/renderer/styles.css`（追加 .kb-* 样式）
- Test: `paperlens/tests/renderer/KnowledgeView.test.tsx`（新建 3 测）

**Step 1: 失败测试**：
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KnowledgeView } from '../../src/renderer/components/KnowledgeView'

const notes = [
  { id: 'n1', paperKey: 'P1', content: '关于RLHF的笔记', tags: ['对齐'], createdAt: 2, notionPageId: null },
  { id: 'n2', paperKey: 'P2', content: '蒸馏方法笔记', tags: ['压缩'], createdAt: 1, notionPageId: null },
]
const baseApi = () => ({
  kbStatus: vi.fn(async () => ({ indexedPapers: 2, totalPapers: 19, totalChunks: 120 })),
  kbIndex: vi.fn(async () => ({ indexed: 0, skipped: 0 })),
  listAllNotes: vi.fn(async () => notes),
  kbAsk: vi.fn(),
})

describe('KnowledgeView', () => {
  it('asks the library and renders streamed answer + clickable sources', async () => {
    const api = baseApi()
    api.kbAsk = vi.fn(async (_q: string, onToken: any) => {
      onToken('根据库内论文，', 'content'); onToken('RLHF 是…[来源1]', 'content')
      return { answer: '根据库内论文，RLHF 是…[来源1]', sources: [{ paperKey: 'P1', title: 'RLHF 论文' }] }
    })
    ;(window as any).api = api
    const onOpenPaper = vi.fn()
    render(<KnowledgeView onOpenPaper={onOpenPaper} />)
    fireEvent.change(screen.getByPlaceholderText(/向整个论文库提问/), { target: { value: 'RLHF 是什么' } })
    fireEvent.click(screen.getByRole('button', { name: '提问' }))
    expect(await screen.findByText(/RLHF 是…/)).toBeInTheDocument()
    const src = await screen.findByRole('button', { name: /RLHF 论文/ })
    fireEvent.click(src)
    expect(onOpenPaper).toHaveBeenCalledWith('P1')
  })

  it('browses all notes and filters by tag chip', async () => {
    ;(window as any).api = baseApi()
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    expect(await screen.findByText('关于RLHF的笔记')).toBeInTheDocument()
    expect(screen.getByText('蒸馏方法笔记')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '对齐' }))
    await waitFor(() => expect(screen.queryByText('蒸馏方法笔记')).not.toBeInTheDocument())
    expect(screen.getByText('关于RLHF的笔记')).toBeInTheDocument()
  })

  it('shows index status and triggers re-index', async () => {
    const api = baseApi()
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /索引状态/ }))
    expect(await screen.findByText(/2 \/ 19/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /更新索引/ }))
    await waitFor(() => expect(api.kbIndex).toHaveBeenCalled())
  })
})
```

**Step 2: 红**（组件不存在）。

**Step 3: 实现** —— `KnowledgeView.tsx`（要点；样式类见 Step 3b）：
```tsx
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
    // 打开即后台增量索引（已索引的会秒过）
    runIndex()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runIndex() {
    if (indexing) return
    setIndexing(true)
    try {
      await window.api.kbIndex((done, total, title) => setProgress(`${done}/${total} ${title}`))
      setStatus(await window.api.kbStatus())
    } catch (e) { setError('索引失败：' + errMsg(e)) } finally { setIndexing(false); setProgress('') }
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
    } catch (e) { setError('问答失败：' + errMsg(e)) } finally { setAsking(false) }
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
          <input placeholder="向整个论文库提问，例如：哪些论文讨论了 RLHF？各自怎么做的？"
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
```

**Step 3b: styles.css 追加**：
```css
/* ─── 知识库 ─────────────────────────────────────────────────── */
.kb { padding: 22px 26px 26px; width: 880px; max-width: calc(100vw - 80px); }
.kb-title { margin: 0 0 12px; font-size: 17px; }
.kb-ask .kb-answer {
  margin-top: 10px; padding: 12px 14px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius);
  max-height: 320px; overflow: auto;
}
.kb-sources { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.kb-notes { margin-top: 10px; }
.kb-note { cursor: pointer; }
.kb-note:hover { border-color: var(--accent-border); }
.kb-index { margin-top: 12px; }
.chip-active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-border); }
```

**Step 4: 绿** 3 passed；tsc 0；全量 renderer 不回归（**96+2**）。

**Step 5: Commit** `git commit -m "feat: KnowledgeView (library Q&A + notes browser + index status)"`

---

### Task KB-8: App 入口（🧠 知识库按钮 + Esc + 来源跳转）

**Files:**
- Modify: `paperlens/src/renderer/App.tsx`
- Test: `paperlens/tests/renderer/App.test.tsx`（追加 1 测；beforeEach mock 增加 kb 方法）

**Step 1: 失败测试** —— beforeEach 的 api 增加：
```ts
    listAllNotes: vi.fn(async () => []),
    kbStatus: vi.fn(async () => ({ indexedPapers: 0, totalPapers: 0, totalChunks: 0 })),
    kbIndex: vi.fn(async () => ({ indexed: 0, skipped: 0 })),
```
追加测试：
```tsx
  it('opens the knowledge base overlay and closes it with Escape', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /知识库/ }))
    expect(await screen.findByRole('dialog', { name: /知识库/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
```

**Step 2: 红。Step 3: 实现** —— App.tsx：
1. `const [showKb, setShowKb] = useState(false)`；Esc effect 改为同时关两个：`if (e.key === 'Escape') { setShowSettings(false); setShowKb(false) }`，依赖 `[showSettings || showKb]` 改为 `[showSettings, showKb]`、guard `if (!showSettings && !showKb) return`。
2. nav-header 按钮区在 ⚙设置 前加：`<button className="btn-ghost" onClick={() => setShowKb(true)}>🧠 知识库</button>`。
3. 模态区追加（与设置同模式）：
```tsx
      {showKb && (
        <div className="modal-backdrop" onClick={() => setShowKb(false)}>
          <div role="dialog" aria-modal="true" aria-label="知识库" className="modal-panel" onClick={e => e.stopPropagation()}>
            <KnowledgeView onOpenPaper={async (paperKey) => {
              setShowKb(false)
              const papers = await window.api.listPapers()
              const p = papers.find(x => x.key === paperKey)
              if (p) setSelected(p)
            }} />
          </div>
        </div>
      )}
```
4. import KnowledgeView。
（注意 `.modal-panel` 默认 width 520px——KnowledgeView 自带 .kb width 880px，需把该模态的面板放宽：给这个 dialog 额外 `style={{ width: 'auto' }}`。）

**Step 4: 绿** App 6 测全过；tsc 0；全量 **97 passed + 2 skipped**。

**Step 5: Commit** `git commit -m "feat: knowledge base entry in app shell (overlay + source jump)"`

---

### Task KB-9: driver KB 步骤 + 回归 + SMOKE + 交付

**Files:**
- Modify: `paperlens/scripts/e2e-drive.mjs`（settings 步骤后追加 KB 步骤，QUICK 模式也跑）
- Modify: `paperlens/docs/SMOKE.md`

**Step 1: driver 追加**（settings-modal 步骤之后）：
```js
  // ── 10. knowledge base: open, status visible, notes tab ───────
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('知识库')).click(); return true`)
  await waitFor('kb open', `return !!document.querySelector('[role="dialog"][aria-label="知识库"]')`, 5000)
  await waitFor('kb notes or empty', `const d=document.querySelector('[role="dialog"][aria-label="知识库"]'); return d && (d.textContent.includes('我的笔记'))`, 5000)
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('索引状态')).click(); return true`)
  await waitFor('kb status', `return /已索引|索引中/.test(document.querySelector('[role="dialog"]').textContent)`, 120000, 2000)
  await shot('12-knowledge-base.png')
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  ok('knowledge-base')
```
（kb:ask 真实问答留给非 QUICK 跑或手动——QUICK 验打开/索引/浏览即可。）

**Step 2: 回归全链**（ABI 舞步）：
- `npm rebuild better-sqlite3` → `npx vitest run` → **97 passed + 2 skipped**；`npx tsc --noEmit` → 0。
- `npx @electron/rebuild -f -w better-sqlite3 -v 32.3.3` → `npm run build` → `DRIVE_QUICK=1 ./node_modules/.bin/electron scripts/e2e-drive.mjs` → 6/6（原 5 + knowledge-base）。注意：KB 步骤会触发**真实全库索引**（本地抽取 19 篇，首次约 1-3 分钟），等待超时已设 120s——若不够调大。
- 截图亲验 `e2e-shots/12-knowledge-base.png`。

**Step 3: SMOKE.md** —— 步骤追加：
```markdown
12. [ ] 点左上「🧠 知识库」→ 首次自动建索引（索引状态 Tab 可看进度，纯本地无费用）→ 「我的笔记」聚合全部笔记、可按标签筛选、点笔记跳回论文。
13. [ ] 知识库顶部提问（如「哪些论文讨论了 RLHF？」）→ 流式回答 + [来源N] 论文 chips，点击跳转到该论文。
```
测试计数行更新为 97 项。

**Step 4: Commit**
```bash
git add paperlens/scripts/e2e-drive.mjs paperlens/docs/SMOKE.md
git commit -m "test+docs: kb driver step and smoke checklist"
```
**Step 5: 切回 Electron ABI、`npm run dev` 重启交付。**

---

## 里程碑

| 里程碑 | Task | 验收 |
|---|---|---|
| M-KB-1 数据与服务 | KB-1–KB-5 | 93+2 全绿（纯本地 TDD） |
| M-KB-2 接线 | KB-6 | tsc + build + 通道核对 |
| M-KB-3 UI | KB-7–KB-8 | 97+2 全绿 |
| M-KB-4 交付 | KB-9 | driver 6/6 + 截图亲验 + 重启 |

## 给执行者的提醒
- ABI 舞步贯穿：vitest 前系统 rebuild，electron/driver 前 @electron/rebuild（SMOKE.md 有记录）。
- `kb:token`/`kb:progress` 与 `chat:token`/`deepread:token` 是并列独立通道，勿混用。
- 扩写调用失败必须回退 `[question]` 继续检索（问答可降级，不可整链失败）。
- KnowledgeView 打开即自动增量索引——测试 mock 必须包含 `kbIndex`，否则挂载即抛。
- 检索词 MATCH 参数要双引号包裹并转义内部引号（已在代码中）。
