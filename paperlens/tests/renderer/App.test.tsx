import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from '../../src/renderer/App'

beforeEach(() => {
  localStorage.clear()
  ;(window as any).api = {
    listPapers: vi.fn(async () => []),
    listCollections: vi.fn(async () => []),
    getConfig: vi.fn(async () => ({ zoteroApiKey: '', zoteroUserId: '', deepseekApiKey: '', deepseekModel: 'deepseek-chat', notionToken: '', notionDatabaseId: '' })),
    listAllNotes: vi.fn(async () => []),
    kbStatus: vi.fn(async () => ({ indexedPapers: 0, totalPapers: 0, totalChunks: 0 })),
    kbIndex: vi.fn(async () => ({ indexed: 0, skipped: 0 })),
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
})
