import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReaderView } from '../../src/renderer/components/ReaderView'

vi.mock('../../src/renderer/components/PdfCanvas', () => ({
  default: ({ data }: { data: ArrayBuffer }) => <div>pdf-rendered:{data.byteLength}</div>,
}))

const paper = { key: 'P1', title: 'T', authors: ['A'], year: 2020, abstract: 'abs', attachmentKey: null }

describe('ReaderView', () => {
  it('shows paper notes and syncs a note to notion on click', async () => {
    const note = { id: 'n1', paperKey: 'P1', content: '要点', tags: [], createdAt: 1, notionPageId: null }
    const syncNote = vi.fn(async () => 'page-1')
    ;(window as any).api = {
      listNotes: vi.fn(async () => [note]),
      syncNote,
    }
    render(<ReaderView paper={paper} />)
    expect(await screen.findByText('要点')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /同步到 Notion/ }))
    await waitFor(() => expect(syncNote).toHaveBeenCalledWith({ noteId: 'n1', paper }))
  })

  it('opens the PDF tab, fetches bytes, and mounts the pdf renderer', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer
    ;(window as any).api = {
      listNotes: vi.fn(async () => []),
      getPaperPdf: vi.fn(async () => bytes),
    }
    render(<ReaderView paper={paper} />)
    fireEvent.click(screen.getByRole('button', { name: /全文 PDF/ }))
    await waitFor(() => expect((window as any).api.getPaperPdf).toHaveBeenCalledWith(paper))
    expect(await screen.findByText(/pdf-rendered:4/)).toBeInTheDocument()
  })

  it('shows an error when notion sync fails', async () => {
    const note = { id: 'n1', paperKey: 'P1', content: '要点', tags: [], createdAt: 1, notionPageId: null }
    ;(window as any).api = {
      listNotes: vi.fn(async () => [note]),
      syncNote: vi.fn(async () => { throw new Error('Notion 400') }),
    }
    render(<ReaderView paper={paper} />)
    await screen.findByText('要点')
    fireEvent.click(screen.getByRole('button', { name: /同步到 Notion/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/失败/))
  })

  it('runs AI deep-read: shows streaming preview then refreshes notes', async () => {
    const newNote = { id: 'n2', paperKey: 'P1', content: '## 背景问题…', tags: ['transformer'], createdAt: 2, notionPageId: null }
    const listNotes = vi.fn(async () => [] as any[])
    const deepReadPaper = vi.fn(async (_p: any, onToken: any) => {
      onToken('## 背景问题…', 'content')
      listNotes.mockResolvedValue([newNote])
      return newNote
    })
    ;(window as any).api = { listNotes, deepReadPaper }
    render(<ReaderView paper={paper} />)
    fireEvent.click(screen.getByRole('button', { name: /AI 精读/ }))
    expect(deepReadPaper).toHaveBeenCalledWith(paper, expect.any(Function))
    await waitFor(() => expect(listNotes).toHaveBeenCalledTimes(2)) // 挂载 1 次 + 完成后刷新 1 次
    // markdown 渲染：笔记中的 '## 背景问题…' 应呈现为标题而非生文本（刷新后元素稳定）
    expect(await screen.findByRole('heading', { name: '背景问题…' })).toBeInTheDocument()
    expect(screen.queryByText(/## 背景问题/)).not.toBeInTheDocument()
  })

  it('renders note tags as chips', async () => {
    const note = { id: 'n1', paperKey: 'P1', content: '要点', tags: ['nlp', 'attention'], createdAt: 1, notionPageId: null }
    ;(window as any).api = { listNotes: vi.fn(async () => [note]) }
    render(<ReaderView paper={paper} />)
    expect(await screen.findByText('nlp')).toBeInTheDocument()
    expect(screen.getByText('attention')).toBeInTheDocument()
  })

  it('refetches notes when notesVersion bumps without resetting the tab', async () => {
    const note = { id: 'n1', paperKey: 'P1', content: '新笔记', tags: [], createdAt: 1, notionPageId: null }
    const listNotes = vi.fn(async () => [] as any[])
    ;(window as any).api = { listNotes }
    const { rerender } = render(<ReaderView paper={paper} notesVersion={0} />)
    await waitFor(() => expect(listNotes).toHaveBeenCalledTimes(1))
    listNotes.mockResolvedValue([note])
    rerender(<ReaderView paper={paper} notesVersion={1} />)
    expect(await screen.findByText('新笔记')).toBeInTheDocument()
    expect(listNotes).toHaveBeenCalledTimes(2)
  })
})
