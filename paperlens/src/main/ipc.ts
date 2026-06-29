import { ipcMain } from 'electron'
import type { Container } from './container'
import { extractPdfText } from './services/pdf-service'
import { buildMessages, buildDeepReadMessages, buildTagMessages, parseTags, buildFollowupMessages, parseFollowups } from './services/ai-chat'
import { chunkPagedText, buildQueryExpansionMessages, parseQueryTerms, buildKbAnswerMessages, buildKbFollowupMessages, buildRerankMessages, parseRerankScores, groupHitsToSources, insertChunks, searchChunks, kbStatus, indexedPaperKeys, representativeChunks, buildReviewMapMessages, buildReviewReduceMessages } from './services/kb'
import { buildAnnotationPayload } from './services/zotero-annotation'
import type { AppConfig, ChatMessage, Paper } from '@shared/types'

// Zotero sortIndex 的「距页顶」只影响侧栏排序（标注在 PDF 上的落点由 annotationPosition 精确给出）。
// 我们没存每页真实高度，但 sortIndex 只需「按页内从上到下单调」即可。取一个大于任何真实页高的
// 参考值，使 top = REF - y 恒为正且随纵坐标下移而增大，A4/Letter/自定义尺寸都不会被 max(0,…) 夹平。
const SORT_REF_TOP_PT = 2000
// 同步在途守卫：避免同一论文并发/重复推送（UI 也会禁用按钮，这里是双保险）
const syncingPapers = new Set<string>()

let currentAbort: AbortController | null = null

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

// PDF bytes: local Zotero storage first (works for WebDAV/local libraries),
// then the Zotero Web API /file (works only for Zotero-cloud-stored files).
async function readPdfBytes(c: Container, info: { key: string; filename: string }): Promise<Uint8Array | null> {
  // 1) local Zotero storage (works for WebDAV/local libraries)
  try {
    const local = c.zoteroLocal().readPdf(info.key, info.filename)
    if (local) return local
  } catch {
    // local read failed (fs error / race) — fall through to the Web API
  }
  // 2) Zotero Web API /file (works only for Zotero-cloud-stored files)
  try {
    return new Uint8Array(await c.zotero().downloadAttachment(info.key))
  } catch {
    return null
  }
}

// 论文全文（含 sqlite 缓存）——paper:text 与 paper:deepread 共用
async function getPaperTextCached(c: Container, paper: Paper): Promise<string> {
  const info = await c.zotero().findPdfAttachmentInfo(paper.key)
  if (!info) return ''
  const cached = c.db.prepare('SELECT text FROM pdf_cache WHERE attachment_key = ?').get(info.key) as { text: string } | undefined
  if (cached) return cached.text
  const bytes = await readPdfBytes(c, info)
  if (!bytes) return ''
  const text = await extractPdfText(bytes)
  if (text) {
    c.db.prepare('INSERT OR REPLACE INTO pdf_cache (attachment_key, text, cached_at) VALUES (?, ?, ?)')
      .run(info.key, text, Date.now())
  }
  return text
}

// 对话引用定位专用：带 [第N页] 标记的正文。会话内存缓存（按附件 key），重启重抽取。
const pagedTextCache = new Map<string, string>()
async function getPaperTextPaged(c: Container, paper: Paper): Promise<string> {
  const info = await c.zotero().findPdfAttachmentInfo(paper.key)
  if (!info) return ''
  const hit = pagedTextCache.get(info.key)
  if (hit !== undefined) return hit
  const bytes = await readPdfBytes(c, info)
  if (!bytes) return ''
  const text = await extractPdfText(bytes, { pageMarkers: true })
  pagedTextCache.set(info.key, text)
  return text
}

// AI 生成 2-4 个标签；任何失败回退空数组，绝不阻塞保存
async function generateTags(c: Container, content: string): Promise<string[]> {
  try {
    return parseTags(await c.ai().complete(buildTagMessages(content)))
  } catch {
    return []
  }
}

export function registerIpc(c: Container) {
  ipcMain.handle('config:get', () => c.configStore.get())
  ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => c.configStore.set(patch))

  ipcMain.handle('zotero:list', (_e, collectionKey: string | null) => c.zotero().listPapers(collectionKey))
  ipcMain.handle('zotero:collections', () => c.zotero().listCollections())

  // 返回论文全文（带 sqlite 缓存）
  ipcMain.handle('paper:text', (_e, paper: Paper): Promise<string> => getPaperTextCached(c, paper))

  // 对话引用定位：带 [第N页] 标记的正文（内存缓存，不入 pdf_cache）
  ipcMain.handle('paper:textPaged', (_e, paper: Paper): Promise<string> => getPaperTextPaged(c, paper))

  // 返回论文 PDF 原始字节（不缓存——按需获取用于前端渲染）
  ipcMain.handle('paper:pdfBytes', async (_e, paper: Paper): Promise<ArrayBuffer | null> => {
    const info = await c.zotero().findPdfAttachmentInfo(paper.key)
    if (!info) return null
    const bytes = await readPdfBytes(c, info)
    return bytes ? toArrayBuffer(bytes) : null
  })

  ipcMain.handle('chat:send', async (_e, args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string }) => {
    const { messages } = buildMessages({ paper: args.paper, paperText: args.paperText, history: args.history, userInput: args.input })
    return c.ai().complete(messages)
  })

  ipcMain.handle('chat:stream', async (event, args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string; deepThink?: boolean }) => {
    const { messages, truncated, usedChars, totalChars } = buildMessages({ paper: args.paper, paperText: args.paperText, history: args.history, userInput: args.input })
    currentAbort = new AbortController()
    try {
      const text = await c.ai({ deepThink: args.deepThink })
        .stream(messages, (delta, kind) => event.sender.send('chat:token', delta, kind), currentAbort.signal)
      return { text, truncated, usedChars, totalChars }
    } finally {
      currentAbort = null
    }
  })

  ipcMain.handle('chat:stop', () => { currentAbort?.abort() })

  ipcMain.handle('chat:history', (_e, paperKey: string) => c.chatRepo.listByPaper(paperKey))
  ipcMain.handle('chat:append', (_e, m: { paperKey: string; role: 'user' | 'assistant'; content: string; reasoning?: string | null }) => c.chatRepo.append(m))
  ipcMain.handle('chat:clear', (_e, paperKey: string) => c.chatRepo.clearByPaper(paperKey))
  ipcMain.handle('chat:replace', (_e, a: { paperKey: string; messages: Array<{ role: 'user' | 'assistant'; content: string; reasoning?: string | null }> }) => c.chatRepo.replaceAll(a.paperKey, a.messages))

  ipcMain.handle('chat:followups', async (_e, a: { paperTitle: string; lastAnswer: string }) => {
    try {
      return parseFollowups(await c.ai().complete(buildFollowupMessages(a.paperTitle, a.lastAnswer)))
    } catch {
      return []
    }
  })

  ipcMain.handle('notes:add', async (_e, n: { paperKey: string; content: string; tags: string[]; autoTag?: boolean }) => {
    const tags = n.autoTag && n.tags.length === 0 ? await generateTags(c, n.content) : n.tags
    return c.notesRepo.add({ paperKey: n.paperKey, content: n.content, tags })
  })
  ipcMain.handle('notes:list', (_e, paperKey: string) => c.notesRepo.listByPaper(paperKey))

  ipcMain.handle('notes:sync', async (_e, args: { noteId: string; paper: Paper }) => {
    const note = c.notesRepo.listByPaper(args.paper.key).find(n => n.id === args.noteId)
    if (!note) throw new Error('note not found')
    const pageId = await c.notion().sync(note, args.paper)
    c.notesRepo.markSynced(note.id, pageId)
    return pageId
  })

  ipcMain.handle('notes:listAll', () => c.notesRepo.listAll())

  ipcMain.handle('notes:delete', (_e, id: string) => c.notesRepo.remove(id))

  // —— PDF 高亮标注 ——
  ipcMain.handle('highlights:list', (_e, paperKey: string) => c.highlightsRepo.listByPaper(paperKey))
  ipcMain.handle('highlights:add', (_e, h: { paperKey: string; pageIndex: number; rects: number[][]; text: string; color: string; comment?: string | null }) =>
    c.highlightsRepo.add(h))
  ipcMain.handle('highlights:update', (_e, a: { id: string; comment?: string | null; color?: string }) => {
    c.highlightsRepo.update(a.id, { comment: a.comment, color: a.color })
  })
  ipcMain.handle('highlights:delete', (_e, id: string) => c.highlightsRepo.remove(id))

  // 把某论文未同步的高亮推送到 Zotero（单向）。需要写权限的 API key。
  ipcMain.handle('highlights:sync', async (_e, paperKey: string) => {
    if (syncingPapers.has(paperKey)) return { synced: 0, failed: 0 } // 已有同步在途，忽略重复请求
    const pending = c.highlightsRepo.listUnsynced(paperKey)
    if (pending.length === 0) return { synced: 0, failed: 0 }
    syncingPapers.add(paperKey)
    try {
      const attachmentKey = await c.zotero().findPdfAttachment(paperKey)
      if (!attachmentKey) throw new Error('该论文在 Zotero 中没有 PDF 附件，无法同步标注')
      let synced = 0, failed = 0
      let lastError = ''
      for (const hl of pending) {
        try {
          const item = buildAnnotationPayload(hl, attachmentKey, SORT_REF_TOP_PT)
          const key = await c.zotero().createAnnotation(item)
          c.highlightsRepo.markSynced(hl.id, key)
          synced++
        } catch (e) {
          failed++
          lastError = e instanceof Error ? e.message : String(e)
        }
      }
      if (synced === 0 && failed > 0) throw new Error(lastError || '同步失败')
      return { synced, failed }
    } finally {
      syncingPapers.delete(paperKey)
    }
  })

  ipcMain.handle('kb:status', async () => {
    const total = (await c.zotero().listPapers()).length
    return { ...kbStatus(c.db), totalPapers: total }
  })

  // 全库索引：逐篇本地抽取 → 切块入库；kb:progress 推进度；单篇失败跳过
  ipcMain.handle('kb:index', async (event) => {
    const papers = await c.zotero().listPapers()
    const done = indexedPaperKeys(c.db)
    let indexed = 0, skipped = 0, processed = 0
    for (const p of papers) {
      processed++
      if (done.has(p.key)) { event.sender.send('kb:progress', processed, papers.length, p.title); continue }
      try {
        const text = await getPaperTextPaged(c, p)
        if (text) { insertChunks(c.db, p.key, p.title, chunkPagedText(text)); indexed++ }
        else skipped++
      } catch { skipped++ }
      event.sender.send('kb:progress', processed, papers.length, p.title)
    }
    return { indexed, skipped, ...kbStatus(c.db) }
  })

  ipcMain.handle('kb:ask', async (event, args: { question: string; history: ChatMessage[]; collectionKey?: string | null }) => {
    // 1) 查询扩写（带对话历史可解析「它」「这种方法」等指代）；失败回退原问题
    let terms: string[] = []
    try { terms = parseQueryTerms(await c.ai().complete(buildQueryExpansionMessages(args.question, args.history))) } catch { /* 扩写失败回退 */ }
    if (terms.length === 0) terms = [args.question]
    // 2) 召回：限定文件夹时取更宽的池再按该范围论文过滤（小集合也能凑够候选）
    const scoped = !!args.collectionKey
    let hits = searchChunks(c.db, terms, scoped ? 80 : 24)
    if (scoped) {
      const allowed = new Set((await c.zotero().listPapers(args.collectionKey)).map(p => p.key))
      hits = hits.filter(h => allowed.has(h.paperKey))
    }
    // 3) 无命中：优雅返回，不抛错
    if (hits.length === 0) {
      return {
        answer: scoped
          ? '该文件夹范围内没有检索到相关内容。可换个问法、改为「全部」范围，或到「索引状态」更新索引后再试。'
          : '知识库中没有检索到与这个问题相关的内容。可以换个问法，或到「索引状态」里更新索引后再试。',
        sources: [], followups: [],
      }
    }
    // 4) 命中多时 LLM rerank：按分数降序稳定排序（同分保持检索原序）；失败直接取前 8
    if (hits.length > 8) {
      try {
        const scores = parseRerankScores(await c.ai().complete(buildRerankMessages(args.question, hits)), hits.length)
        if (scores) {
          hits = hits
            .map((h, i) => ({ h, i, s: scores[i] }))
            .sort((a, b) => b.s - a.s || a.i - b.i)
            .map(x => x.h)
        }
      } catch { /* rerank 失败 → 保持 bm25 排序 */ }
    }
    // 5) 按论文聚合来源（chips 顺序即 [来源N] 编号，含 chunks 原文供前端展示）
    const sources = groupHitsToSources(hits.slice(0, 8))
    const answer = await c.ai().stream(
      buildKbAnswerMessages(args.question, sources, args.history),
      (delta, kind) => event.sender.send('kb:token', delta, kind))
    // 追问建议：失败不影响主回答
    let followups: string[] = []
    try { followups = parseFollowups(await c.ai().complete(buildKbFollowupMessages(answer))) } catch { /* 忽略 */ }
    return { answer, sources, followups }
  })

  // 一键结构化精读：流式生成 → 自动打标签 → 直接存为笔记
  ipcMain.handle('paper:deepread', async (event, paper: Paper) => {
    const paperText = await getPaperTextCached(c, paper)
    const messages = buildDeepReadMessages(
      paper, paperText || '（未能获取论文正文。请仅基于元数据撰写，并在开头明确说明缺乏正文。）')
    const content = await c.ai().stream(messages, (delta, kind) => event.sender.send('deepread:token', delta, kind))
    if (!content) throw new Error('精读生成失败：AI 未返回内容')
    const tags = await generateTags(c, content)
    return c.notesRepo.add({ paperKey: paper.key, content, tags })
  })

  // 自动综述：map（逐篇要点提炼）+ reduce（汇总综述，流式）
  ipcMain.handle('kb:review', async (event, args: { collectionKey: string | null; scopeLabel: string }) => {
    const papers = await c.zotero().listPapers(args.collectionKey)
    const indexed = indexedPaperKeys(c.db)
    const scoped = papers.filter(p => indexed.has(p.key))
    if (scoped.length === 0) return { content: '该范围内没有已索引的论文，请先到「索引状态」更新索引。', papers: 0, skipped: papers.length }
    const items: Array<{ title: string; points: string }> = []
    let done = 0, skipped = papers.length - scoped.length
    for (const p of scoped) {
      try {
        const points = await c.ai().complete(buildReviewMapMessages(p.title, representativeChunks(c.db, p.key)))
        items.push({ title: p.title, points })
      } catch { skipped++ }
      done++
      event.sender.send('kb:review-progress', done, scoped.length, p.title)
    }
    if (items.length === 0) throw new Error('综述失败：所有论文要点提炼均失败')
    const content = await c.ai().stream(
      buildReviewReduceMessages(args.scopeLabel, items),
      (delta, kind) => event.sender.send('kb:review-token', delta, kind),
    )
    return { content, papers: items.length, skipped }
  })
}
