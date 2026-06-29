import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, ChatMessage, Highlight, Note, Paper, ZoteroCollection } from '@shared/types'
import type { ChatRecord } from '../main/services/chat-repo'

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (p: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:set', p),
  listPapers: (collectionKey?: string | null): Promise<Paper[]> => ipcRenderer.invoke('zotero:list', collectionKey ?? null),
  listCollections: (): Promise<ZoteroCollection[]> => ipcRenderer.invoke('zotero:collections'),
  getPaperText: (paper: Paper): Promise<string> => ipcRenderer.invoke('paper:text', paper),
  getPaperTextPaged: (paper: Paper): Promise<string> => ipcRenderer.invoke('paper:textPaged', paper),
  getPaperPdf: (paper: Paper): Promise<ArrayBuffer | null> => ipcRenderer.invoke('paper:pdfBytes', paper),
  sendChat: (a: { paper: Paper; paperText: string; history: ChatMessage[]; input: string }): Promise<string> =>
    ipcRenderer.invoke('chat:send', a),
  streamChat: (
    args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string; deepThink?: boolean },
    onToken: (delta: string, kind: 'content' | 'reasoning') => void,
  ): Promise<{ text: string; truncated: boolean; usedChars: number; totalChars: number }> => {
    const listener = (_e: Electron.IpcRendererEvent, delta: string, kind: 'content' | 'reasoning') => onToken(delta, kind)
    ipcRenderer.on('chat:token', listener)
    return ipcRenderer.invoke('chat:stream', args).finally(() => {
      ipcRenderer.removeListener('chat:token', listener)
    })
  },
  stopChat: (): Promise<void> => ipcRenderer.invoke('chat:stop'),
  loadChat: (paperKey: string): Promise<ChatRecord[]> => ipcRenderer.invoke('chat:history', paperKey),
  appendChat: (m: { paperKey: string; role: 'user' | 'assistant'; content: string; reasoning?: string | null }): Promise<ChatRecord> => ipcRenderer.invoke('chat:append', m),
  clearChat: (paperKey: string): Promise<void> => ipcRenderer.invoke('chat:clear', paperKey),
  replaceChat: (paperKey: string, messages: Array<{ role: 'user' | 'assistant'; content: string; reasoning?: string | null }>): Promise<void> => ipcRenderer.invoke('chat:replace', { paperKey, messages }),
  getFollowups: (a: { paperTitle: string; lastAnswer: string }): Promise<string[]> => ipcRenderer.invoke('chat:followups', a),
  addNote: (n: { paperKey: string; content: string; tags: string[]; autoTag?: boolean }): Promise<Note> =>
    ipcRenderer.invoke('notes:add', n),
  listNotes: (paperKey: string): Promise<Note[]> => ipcRenderer.invoke('notes:list', paperKey),
  syncNote: (a: { noteId: string; paper: Paper }): Promise<string> => ipcRenderer.invoke('notes:sync', a),
  deepReadPaper: (paper: Paper, onToken: (delta: string, kind: 'content' | 'reasoning') => void): Promise<Note> => {
    const listener = (_e: Electron.IpcRendererEvent, delta: string, kind: 'content' | 'reasoning') => onToken(delta, kind)
    ipcRenderer.on('deepread:token', listener)
    return ipcRenderer.invoke('paper:deepread', paper).finally(() => {
      ipcRenderer.removeListener('deepread:token', listener)
    })
  },
  listAllNotes: (): Promise<Note[]> => ipcRenderer.invoke('notes:listAll'),
  kbStatus: (): Promise<{ indexedPapers: number; totalChunks: number; totalPapers: number }> =>
    ipcRenderer.invoke('kb:status'),
  kbIndex: (onProgress: (done: number, total: number, title: string) => void): Promise<{ indexed: number; skipped: number }> => {
    const listener = (_e: Electron.IpcRendererEvent, done: number, total: number, title: string) => onProgress(done, total, title)
    ipcRenderer.on('kb:progress', listener)
    return ipcRenderer.invoke('kb:index').finally(() => ipcRenderer.removeListener('kb:progress', listener))
  },
  kbAsk: (
    args: { question: string; history: ChatMessage[]; collectionKey?: string | null },
    onToken: (delta: string, kind: 'content' | 'reasoning') => void,
  ): Promise<{ answer: string; sources: Array<{ paperKey: string; paperTitle: string; chunks: string[] }>; followups: string[] }> => {
    const listener = (_e: Electron.IpcRendererEvent, delta: string, kind: 'content' | 'reasoning') => onToken(delta, kind)
    ipcRenderer.on('kb:token', listener)
    return ipcRenderer.invoke('kb:ask', args).finally(() => ipcRenderer.removeListener('kb:token', listener))
  },
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke('notes:delete', id),
  listHighlights: (paperKey: string): Promise<Highlight[]> => ipcRenderer.invoke('highlights:list', paperKey),
  addHighlight: (h: { paperKey: string; pageIndex: number; rects: number[][]; text: string; color: string; comment?: string | null }): Promise<Highlight> =>
    ipcRenderer.invoke('highlights:add', h),
  updateHighlight: (a: { id: string; comment?: string | null; color?: string }): Promise<void> => ipcRenderer.invoke('highlights:update', a),
  deleteHighlight: (id: string): Promise<void> => ipcRenderer.invoke('highlights:delete', id),
  syncHighlights: (paperKey: string): Promise<{ synced: number; failed: number }> => ipcRenderer.invoke('highlights:sync', paperKey),
  kbReview: (
    args: { collectionKey: string | null; scopeLabel: string },
    onProgress: (done: number, total: number, title: string) => void,
    onToken: (delta: string, kind: 'content' | 'reasoning') => void,
  ): Promise<{ content: string; papers: number; skipped: number }> => {
    const p = (_e: Electron.IpcRendererEvent, done: number, total: number, title: string) => onProgress(done, total, title)
    const t = (_e: Electron.IpcRendererEvent, delta: string, kind: 'content' | 'reasoning') => onToken(delta, kind)
    ipcRenderer.on('kb:review-progress', p); ipcRenderer.on('kb:review-token', t)
    return ipcRenderer.invoke('kb:review', args).finally(() => {
      ipcRenderer.removeListener('kb:review-progress', p); ipcRenderer.removeListener('kb:review-token', t)
    })
  },
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
