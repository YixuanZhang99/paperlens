import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, ChatMessage, Note, Paper } from '@shared/types'

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (p: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:set', p),
  listPapers: (): Promise<Paper[]> => ipcRenderer.invoke('zotero:list'),
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
  addNote: (n: { paperKey: string; content: string; tags: string[] }): Promise<Note> =>
    ipcRenderer.invoke('notes:add', n),
  listNotes: (paperKey: string): Promise<Note[]> => ipcRenderer.invoke('notes:list', paperKey),
  syncNote: (a: { noteId: string; paper: Paper }): Promise<string> => ipcRenderer.invoke('notes:sync', a),
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
