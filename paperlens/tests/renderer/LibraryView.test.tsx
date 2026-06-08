import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LibraryView } from '../../src/renderer/components/LibraryView'

const papers = [
  { key: 'P1', title: 'Transformer', authors: ['Vaswani'], year: 2017, abstract: '', attachmentKey: null },
  { key: 'P2', title: 'BERT', authors: ['Devlin'], year: 2018, abstract: '', attachmentKey: null },
]

describe('LibraryView', () => {
  it('lists papers from api and notifies on click', async () => {
    ;(window as any).api = { listPapers: vi.fn(async () => papers) }
    const onSelect = vi.fn()
    render(<LibraryView onSelect={onSelect} selectedKey={null} />)

    expect(await screen.findByText('Transformer')).toBeInTheDocument()
    expect(screen.getByText('BERT')).toBeInTheDocument()

    fireEvent.click(screen.getByText('BERT'))
    expect(onSelect).toHaveBeenCalledWith(papers[1])
  })

  it('shows an error message when loading fails', async () => {
    ;(window as any).api = { listPapers: vi.fn(async () => { throw new Error('403') }) }
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/加载失败/))
  })
})
