import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReaderView } from '../../src/renderer/components/ReaderView'

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
})
