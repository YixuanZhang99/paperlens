import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatView } from '../../src/renderer/components/ChatView'

const paper = { key: 'P1', title: 'T', authors: ['A'], year: 2020, abstract: '', attachmentKey: null }

describe('ChatView', () => {
  it('sends user input and renders assistant reply', async () => {
    ;(window as any).api = {
      getPaperText: vi.fn(async () => '论文全文'),
      sendChat: vi.fn(async () => '这是AI的回答'),
    }
    render(<ChatView paper={paper} />)

    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: '讲讲贡献' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))

    expect(await screen.findByText('讲讲贡献')).toBeInTheDocument()
    expect(await screen.findByText('这是AI的回答')).toBeInTheDocument()
    expect((window as any).api.sendChat).toHaveBeenCalledWith(
      expect.objectContaining({ input: '讲讲贡献', paper })
    )
  })

  it('saves the last assistant reply as a note', async () => {
    const addNote = vi.fn(async () => ({}))
    ;(window as any).api = {
      getPaperText: vi.fn(async () => 'x'),
      sendChat: vi.fn(async () => '可保存的学习要点'),
      addNote,
    }
    render(<ChatView paper={paper} />)
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await screen.findByText('可保存的学习要点')

    fireEvent.click(screen.getByRole('button', { name: /存为笔记/ }))
    await waitFor(() => expect(addNote).toHaveBeenCalledWith(
      expect.objectContaining({ paperKey: 'P1', content: '可保存的学习要点' })
    ))
  })
})
