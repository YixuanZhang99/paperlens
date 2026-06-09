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
})
