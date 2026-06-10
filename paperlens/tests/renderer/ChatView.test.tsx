import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatView } from '../../src/renderer/components/ChatView'

const paper = { key: 'P1', title: 'T', authors: ['A'], year: 2020, abstract: '', attachmentKey: null }

describe('ChatView', () => {
  it('streams the assistant reply and shows the accumulated text', async () => {
    const streamChat = vi.fn(async (_args: any, onToken: (d: string) => void) => {
      onToken('这是'); onToken('AI'); onToken('的回答')
      return '这是AI的回答'
    })
    ;(window as any).api = {
      getPaperText: vi.fn(async () => '论文全文'),
      streamChat,
    }
    render(<ChatView paper={paper} />)

    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: '讲讲贡献' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))

    expect(await screen.findByText('讲讲贡献')).toBeInTheDocument()
    expect(await screen.findByText('这是AI的回答')).toBeInTheDocument()
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ input: '讲讲贡献', paper }),
      expect.any(Function),
    )
  })

  it('renders assistant markdown (headings/bold), not raw marker text', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => {
      onToken('## 重点\n\n这是**加粗**结论', 'content'); return '## 重点\n\n这是**加粗**结论'
    })
    ;(window as any).api = { getPaperText: vi.fn(async () => 'x'), streamChat }
    render(<ChatView paper={paper} />)
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(await screen.findByRole('heading', { name: '重点' })).toBeInTheDocument()
    expect(screen.getByText('加粗')).toBeInTheDocument()
    expect(screen.queryByText(/## 重点/)).not.toBeInTheDocument()
  })

  it('saves the last assistant reply as a note', async () => {
    const addNote = vi.fn(async () => ({}))
    const onNoteSaved = vi.fn()
    ;(window as any).api = {
      getPaperText: vi.fn(async () => 'x'),
      streamChat: vi.fn(async (_args: any, onToken: (d: string) => void) => {
        onToken('可保存的学习要点'); return '可保存的学习要点'
      }),
      addNote,
    }
    render(<ChatView paper={paper} onNoteSaved={onNoteSaved} />)
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await screen.findByText('可保存的学习要点')

    fireEvent.click(screen.getByRole('button', { name: /存为笔记/ }))
    await waitFor(() => expect(addNote).toHaveBeenCalledWith(
      expect.objectContaining({ paperKey: 'P1', content: '可保存的学习要点', autoTag: true })
    ))
    await waitFor(() => expect(onNoteSaved).toHaveBeenCalled())
  })

  it('shows an error banner when streaming fails', async () => {
    ;(window as any).api = {
      getPaperText: vi.fn(async () => 'x'),
      streamChat: vi.fn(async () => { throw new Error('DeepSeek 401') }),
    }
    render(<ChatView paper={paper} />)
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/失败/))
  })

  it('renders quick prompt chips and sends the prompt on click', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => { onToken('好的', 'content'); return '好的' })
    ;(window as any).api = { getPaperText: vi.fn(async () => 'x'), streamChat }
    render(<ChatView paper={paper} />)
    fireEvent.click(screen.getByRole('button', { name: '核心贡献' }))
    expect(await screen.findByText('好的')).toBeInTheDocument()
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.stringContaining('核心贡献') }),
      expect.any(Function),
    )
  })

  it('passes deepThink=true when the 深思 toggle is on', async () => {
    const streamChat = vi.fn(async () => '答')
    ;(window as any).api = { getPaperText: vi.fn(async () => 'x'), streamChat }
    render(<ChatView paper={paper} />)
    fireEvent.click(screen.getByLabelText('深思'))
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await waitFor(() => expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ deepThink: true }), expect.any(Function)))
  })

  it('renders reasoning tokens in a separate dimmed block above the answer', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => {
      onToken('思考过程…', 'reasoning'); onToken('最终答案', 'content'); return '最终答案'
    })
    ;(window as any).api = { getPaperText: vi.fn(async () => 'x'), streamChat }
    render(<ChatView paper={paper} />)
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(await screen.findByText('思考过程…')).toBeInTheDocument()
    expect(await screen.findByText('最终答案')).toBeInTheDocument()
  })
})
