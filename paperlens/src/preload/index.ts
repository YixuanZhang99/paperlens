import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, ChatMessage, Note, Paper, ZoteroCollection } from '@shared/types'

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (p: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:set', p),
  listPapers: (collectionKey?: string | null): Promise<Paper[]> => ipcRenderer.invoke('zotero:list', collectionKey ?? null),
  listCollections: (): Promise<ZoteroCollection[]> => ipcRenderer.invoke('zotero:collections'),
  getPaperText: (paper: Paper): Promise<string> => ipcRenderer.invoke('paper:text', paper),
  getPaperPdf: (paper: Paper): Promise<ArrayBuffer | null> => ipcRenderer.invoke('paper:pdfBytes', paper),
  sendChat: (a: { paper: Paper; paperText: string; history: ChatMessage[]; input: string }): Promise<string> =>
    ipcRenderer.invoke('chat:send', a),
  streamChat: (
    args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string; deepThink?: boolean },
    onToken: (delta: string, kind: 'content' | 'reasoning') => void,
  ): Promise<string> => {
    const listener = (_e: Electron.IpcRendererEvent, delta: string, kind: 'content' | 'reasoning') => onToken(delta, kind)
    ipcRenderer.on('chat:token', listener)
    return ipcRenderer.invoke('chat:stream', args).finally(() => {
      ipcRenderer.removeListener('chat:token', listener)
    })
  },
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
    question: string,
    onToken: (delta: string, kind: 'content' | 'reasoning') => void,
  ): Promise<{ answer: string; sources: Array<{ paperKey: string; title: string }> }> => {
    const listener = (_e: Electron.IpcRendererEvent, delta: string, kind: 'content' | 'reasoning') => onToken(delta, kind)
    ipcRenderer.on('kb:token', listener)
    return ipcRenderer.invoke('kb:ask', question).finally(() => ipcRenderer.removeListener('kb:token', listener))
  },
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
