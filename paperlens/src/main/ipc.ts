import { ipcMain } from 'electron'
import type { Container } from './container'
import { extractPdfText } from './services/pdf-service'
import { buildMessages, buildDeepReadMessages, buildTagMessages, parseTags } from './services/ai-chat'
import { chunkText, buildQueryExpansionMessages, parseQueryTerms, buildKbAnswerMessages, insertChunks, searchChunks, kbStatus, indexedPaperKeys } from './services/kb'
import type { AppConfig, ChatMessage, Paper } from '@shared/types'

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

  // 返回论文 PDF 原始字节（不缓存——按需获取用于前端渲染）
  ipcMain.handle('paper:pdfBytes', async (_e, paper: Paper): Promise<ArrayBuffer | null> => {
    const info = await c.zotero().findPdfAttachmentInfo(paper.key)
    if (!info) return null
    const bytes = await readPdfBytes(c, info)
    return bytes ? toArrayBuffer(bytes) : null
  })

  ipcMain.handle('chat:send', async (_e, args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string }) => {
    const messages = buildMessages({ paper: args.paper, paperText: args.paperText, history: args.history, userInput: args.input })
    return c.ai().complete(messages)
  })

  ipcMain.handle('chat:stream', async (event, args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string; deepThink?: boolean }) => {
    const messages = buildMessages({ paper: args.paper, paperText: args.paperText, history: args.history, userInput: args.input })
    return c.ai(args.deepThink ? 'deepseek-reasoner' : undefined)
      .stream(messages, (delta, kind) => event.sender.send('chat:token', delta, kind))
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
}
