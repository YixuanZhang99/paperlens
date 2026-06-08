import { ipcMain } from 'electron'
import type { Container } from './container'
import { extractPdfText } from './services/pdf-service'
import { buildMessages } from './services/ai-chat'
import type { AppConfig, ChatMessage, Paper } from '@shared/types'

export function registerIpc(c: Container) {
  ipcMain.handle('config:get', () => c.configStore.get())
  ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => c.configStore.set(patch))

  ipcMain.handle('zotero:list', () => c.zotero().listPapers())

  // 返回论文全文（带 sqlite 缓存）
  ipcMain.handle('paper:text', async (_e, paper: Paper): Promise<string> => {
    const z = c.zotero()
    const attKey = paper.attachmentKey ?? (await z.findPdfAttachment(paper.key))
    if (!attKey) return ''
    const cached = c.db.prepare('SELECT text FROM pdf_cache WHERE attachment_key = ?').get(attKey) as { text: string } | undefined
    if (cached) return cached.text
    const bytes = new Uint8Array(await z.downloadAttachment(attKey))
    const text = await extractPdfText(bytes)
    c.db.prepare('INSERT OR REPLACE INTO pdf_cache (attachment_key, text, cached_at) VALUES (?, ?, ?)')
      .run(attKey, text, Date.now())
    return text
  })

  ipcMain.handle('chat:send', async (_e, args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string }) => {
    const messages = buildMessages({ paper: args.paper, paperText: args.paperText, history: args.history, userInput: args.input })
    return c.ai().complete(messages)
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
