import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from '../../src/renderer/App'

beforeEach(() => {
  localStorage.clear()
  ;(window as any).api = {
    listPapers: vi.fn(async () => []),
    listCollections: vi.fn(async () => []),
    getConfig: vi.fn(async () => ({ zoteroApiKey: '', zoteroUserId: '', deepseekApiKey: '', deepseekModel: 'deepseek-v4-flash', notionToken: '', notionDatabaseId: '' })),
    listAllNotes: vi.fn(async () => []),
    kbStatus: vi.fn(async () => ({ indexedPapers: 0, totalPapers: 0, totalChunks: 0 })),
    kbIndex: vi.fn(async () => ({ indexed: 0, skipped: 0 })),
    getPaperTextPaged: vi.fn(async () => '[第1页]\n正文'),
    getPaperText: vi.fn(async () => '正文'),
    streamChat: vi.fn(async (_a: any, onToken: any) => { onToken('答', 'content'); return { text: '答', truncated: false, usedChars: 1, totalChars: 1 } }),
    stopChat: vi.fn(async () => {}),
    loadChat: vi.fn(async () => []),
    appendChat: vi.fn(async () => ({ id: 1, paperKey: '', role: 'user', content: '', reasoning: null, createdAt: 0 })),
    clearChat: vi.fn(async () => {}),
    replaceChat: vi.fn(async () => {}),
    getFollowups: vi.fn(async () => []),
    listNotes: vi.fn(async () => []),
    addNote: vi.fn(async () => ({})),
    getPaperPdf: vi.fn(async () => new ArrayBuffer(8)),
    deepReadPaper: vi.fn(async () => ({})),
    syncNote: vi.fn(async () => ''),
  }
})

describe('App', () => {
  it('renders the three-pane layout with library, reader, chat regions', async () => {
    render(<App />)
    expect(await screen.findByRole('navigation', { name: /论文库/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /阅读/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /对话/ })).toBeInTheDocument()
  })

  it('opens the settings dialog and closes it with Escape', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /设置/ }))
    expect(await screen.findByRole('dialog', { name: /设置/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes settings on backdrop click but not when clicking inside the panel', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /设置/ }))
    const dialog = await screen.findByRole('dialog')
    const heading = await screen.findByRole('heading', { name: '设置' })
    fireEvent.click(heading) // inside the panel → stays open
    expect(screen.queryByRole('dialog')).toBeInTheDocument()
    fireEvent.click(dialog.parentElement!) // the backdrop → closes
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('collapses and expands the library pane', async () => {
    render(<App />)
    expect(await screen.findByText('全部论文')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起论文库' }))
    expect(screen.queryByText('全部论文')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开论文库' }))
    expect(await screen.findByText('全部论文')).toBeInTheDocument()
  })

  it('collapses and expands the chat pane', async () => {
    render(<App />)
    expect(await screen.findByText('请选择一篇论文开始对话')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起对话' }))
    expect(screen.queryByText('请选择一篇论文开始对话')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开对话' }))
    expect(await screen.findByText('请选择一篇论文开始对话')).toBeInTheDocument()
  })

  it('kicks off a silent incremental kb index on mount', async () => {
    render(<App />)
    await waitFor(() => expect((window as any).api.kbIndex).toHaveBeenCalled())
  })

  it('opens the knowledge base overlay and closes it with Escape', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /知识库/ }))
    expect(await screen.findByRole('dialog', { name: /知识库/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // CJ-7: routes a [页N] click in chat to the reader via jumpTarget
  it('routes a [页N] click in chat to the reader via jumpTarget', async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    ;(window as any).api.listPapers = vi.fn(async () => [{ key: 'P1', title: 'TPaper', authors: [], year: 2020, abstract: '', attachmentKey: null }])
    ;(window as any).api.getPaperTextPaged = vi.fn(async () => '[第1页]\n正文')
    ;(window as any).api.getPaperPdf = vi.fn(async () => new ArrayBuffer(8))
    ;(window as any).api.streamChat = vi.fn(async (_a: any, onToken: any) => { onToken('见 [页1]', 'content'); return { text: '见 [页1]', truncated: false, usedChars: 1, totalChars: 1 } })
    render(<App />)
    // click the paper to select it
    fireEvent.click(await screen.findByText('TPaper'))
    // wait for ChatView to be ready (send button enabled)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    // send a question and get chip in response
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    // wait for streaming to complete
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    // click the [页1] chip — this should trigger jumpTarget → ReaderView → getPaperPdf
    fireEvent.click(screen.getByRole('button', { name: '[页1]' }))
    await waitFor(() => expect((window as any).api.getPaperPdf).toHaveBeenCalled())
  })
})
