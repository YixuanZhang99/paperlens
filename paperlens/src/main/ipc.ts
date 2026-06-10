import { ipcMain } from 'electron'
import type { Container } from './container'
import { extractPdfText } from './services/pdf-service'
import { buildMessages } from './services/ai-chat'
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

export function registerIpc(c: Container) {
  ipcMain.handle('config:get', () => c.configStore.get())
  ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => c.configStore.set(patch))

  ipcMain.handle('zotero:list', () => c.zotero().listPapers())

  // 返回论文全文（带 sqlite 缓存）
  ipcMain.handle('paper:text', async (_e, paper: Paper): Promise<string> => {
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
  })

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

  ipcMain.handle('notes:add', (_e, n: { paperKey: string; content: string; tags: string[] }) => c.notesRepo.add(n))
  ipcMain.handle('notes:list', (_e, paperKey: string) => c.notesRepo.listByPaper(paperKey))

  ipcMain.handle('notes:sync', async (_e, args: { noteId: string; paper: Paper }) => {
    const note = c.notesRepo.listByPaper(args.paper.key).find(n => n.id === args.noteId)
    if (!note) throw new Error('note not found')
    const pageId = await c.notion().sync(note, args.paper)
    c.notesRepo.markSynced(note.id, pageId)
    return pageId
  })
}
