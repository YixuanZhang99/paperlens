import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatView } from '../../src/renderer/components/ChatView'

const paper = { key: 'P1', title: 'T', authors: ['A'], year: 2020, abstract: '', attachmentKey: null }

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    getPaperText: vi.fn(async () => '论文全文'),
    streamChat: vi.fn(async (_args: any, onToken: (d: string, k: string) => void) => {
      onToken('这是', 'content'); onToken('AI', 'content'); onToken('的回答', 'content')
      return { text: '这是AI的回答', truncated: false, usedChars: 100, totalChars: 100 }
    }),
    stopChat: vi.fn(async () => {}),
    loadChat: vi.fn(async () => []),
    appendChat: vi.fn(async () => ({ id: 1, paperKey: 'P1', role: 'user', content: '', reasoning: null, createdAt: 0 })),
    clearChat: vi.fn(async () => {}),
    replaceChat: vi.fn(async () => {}),
    getFollowups: vi.fn(async () => []),
    addNote: vi.fn(async () => ({})),
    ...overrides,
  }
}

beforeEach(() => {
  ;(window as any).api = makeApi()
})

describe('ChatView', () => {
  it('streams the assistant reply and shows the accumulated text', async () => {
    const streamChat = vi.fn(async (_args: any, onToken: (d: string, k: string) => void) => {
      onToken('这是', 'content'); onToken('AI', 'content'); onToken('的回答', 'content')
      return { text: '这是AI的回答', truncated: false, usedChars: 100, totalChars: 100 }
    })
    ;(window as any).api = makeApi({ streamChat })
    render(<ChatView paper={paper} />)

    await waitFor(() => expect((window as any).api.getPaperText).toHaveBeenCalled())
    // Simulate text ready by waiting for the send button to be enabled
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())

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
      onToken('## 重点\n\n这是**加粗**结论', 'content')
      return { text: '## 重点\n\n这是**加粗**结论', truncated: false, usedChars: 50, totalChars: 50 }
    })
    ;(window as any).api = makeApi({ streamChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(await screen.findByRole('heading', { name: '重点' })).toBeInTheDocument()
    expect(screen.getByText('加粗')).toBeInTheDocument()
    expect(screen.queryByText(/## 重点/)).not.toBeInTheDocument()
  })

  it('renders quick prompt chips and sends the prompt on click', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => {
      onToken('好的', 'content')
      return { text: '好的', truncated: false, usedChars: 10, totalChars: 10 }
    })
    ;(window as any).api = makeApi({ streamChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '核心贡献' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '核心贡献' }))
    expect(await screen.findByText('好的')).toBeInTheDocument()
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.stringContaining('核心贡献') }),
      expect.any(Function),
    )
  })

  it('passes deepThink=true when the 深思 toggle is on', async () => {
    const streamChat = vi.fn(async () => ({ text: '答', truncated: false, usedChars: 1, totalChars: 1 }))
    ;(window as any).api = makeApi({ streamChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.click(screen.getByLabelText('深思'))
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await waitFor(() => expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ deepThink: true }), expect.any(Function)))
  })

  it('sends on plain Enter but not while IME composition is active', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => {
      onToken('答', 'content')
      return { text: '答', truncated: false, usedChars: 1, totalChars: 1 }
    })
    ;(window as any).api = makeApi({ streamChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    const input = screen.getByPlaceholderText(/输入问题/)

    fireEvent.change(input, { target: { value: 'zhongwen' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(streamChat).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '中文问题' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1))
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ input: '中文问题' }), expect.any(Function))
  })

  it('renders reasoning tokens in a separate dimmed block above the answer', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => {
      onToken('思考过程…', 'reasoning'); onToken('最终答案', 'content')
      return { text: '最终答案', truncated: false, usedChars: 50, totalChars: 50 }
    })
    ;(window as any).api = makeApi({ streamChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(await screen.findByText('思考过程…')).toBeInTheDocument()
    expect(await screen.findByText('最终答案')).toBeInTheDocument()
  })

  it('shows an error banner when streaming fails', async () => {
    ;(window as any).api = makeApi({
      streamChat: vi.fn(async () => { throw new Error('DeepSeek 401') }),
    })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/失败/))
  })

  it('saves the last assistant reply as a note via bubble action', async () => {
    const addNote = vi.fn(async () => ({}))
    const onNoteSaved = vi.fn()
    ;(window as any).api = makeApi({
      streamChat: vi.fn(async (_args: any, onToken: (d: string, k: string) => void) => {
        onToken('可保存的学习要点', 'content')
        return { text: '可保存的学习要点', truncated: false, usedChars: 10, totalChars: 10 }
      }),
      addNote,
    })
    render(<ChatView paper={paper} onNoteSaved={onNoteSaved} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await screen.findByText('可保存的学习要点')

    fireEvent.click(screen.getByRole('button', { name: /存为笔记/ }))
    await waitFor(() => expect(addNote).toHaveBeenCalledWith(
      expect.objectContaining({ paperKey: 'P1', autoTag: true })
    ))
    await waitFor(() => expect(onNoteSaved).toHaveBeenCalled())
  })

  // P0: 切论文时调 loadChat 并渲染返回的历史消息
  it('loads and renders chat history when paper changes', async () => {
    const loadChat = vi.fn(async () => [
      { id: 1, paperKey: 'P1', role: 'user' as const, content: '历史提问', reasoning: null, createdAt: 1 },
      { id: 2, paperKey: 'P1', role: 'assistant' as const, content: '历史回答', reasoning: null, createdAt: 2 },
    ])
    ;(window as any).api = makeApi({ loadChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(loadChat).toHaveBeenCalledWith('P1'))
    expect(await screen.findByText('历史提问')).toBeInTheDocument()
    expect(await screen.findByText('历史回答')).toBeInTheDocument()
  })

  // P0: 发送后 user 与 assistant 都触发 appendChat
  it('calls appendChat for both user and assistant messages', async () => {
    const appendChat = vi.fn(async () => ({ id: 1, paperKey: 'P1', role: 'user', content: '', reasoning: null, createdAt: 0 }))
    ;(window as any).api = makeApi({ appendChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: '测试问题' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await waitFor(() => expect(appendChat).toHaveBeenCalledTimes(2))
    expect(appendChat).toHaveBeenNthCalledWith(1, expect.objectContaining({ role: 'user', content: '测试问题' }))
    expect(appendChat).toHaveBeenNthCalledWith(2, expect.objectContaining({ role: 'assistant' }))
  })

  // P0: 流式中「发送」变「停止」，点击调 stopChat
  it('shows stop button while streaming and calls stopChat on click', async () => {
    let resolveStream!: (v: any) => void
    const streamChat = vi.fn((_a: any, onToken: any) => {
      onToken('partial', 'content')
      return new Promise(res => { resolveStream = res })
    })
    const stopChat = vi.fn(async () => {})
    ;(window as any).api = makeApi({ streamChat, stopChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))

    // While streaming, the stop button should appear
    await waitFor(() => expect(screen.getByRole('button', { name: /停止/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /停止/ }))
    expect(stopChat).toHaveBeenCalled()

    // Resolve to avoid hanging
    resolveStream({ text: 'partial', truncated: false, usedChars: 10, totalChars: 10 })
  })

  // P0: 截断信息显示
  it('shows truncation warning in context bar when truncated=true', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => {
      onToken('答', 'content')
      return { text: '答', truncated: true, usedChars: 80000, totalChars: 200000 }
    })
    ;(window as any).api = makeApi({ streamChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await waitFor(() => expect(screen.getByText(/⚠ 正文较长/)).toBeInTheDocument())
    expect(screen.getByText(/⚠ 正文较长/)).toBeInTheDocument()
  })

  // P0: textReady=false 时发送禁用
  it('disables send button while paper text is loading', async () => {
    // getPaperText never resolves
    ;(window as any).api = makeApi({
      getPaperText: vi.fn(() => new Promise(() => {})),
    })
    render(<ChatView paper={paper} />)
    const sendBtn = screen.getByRole('button', { name: /发送/ })
    expect(sendBtn).toBeDisabled()
  })

  // P1: 气泡「复制」调 clipboard
  it('calls clipboard.writeText when copy button is clicked', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    ;(window as any).api = makeApi({
      streamChat: vi.fn(async (_a: any, onToken: any) => {
        onToken('要复制的内容', 'content')
        return { text: '要复制的内容', truncated: false, usedChars: 10, totalChars: 10 }
      }),
    })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await screen.findByText('要复制的内容')
    fireEvent.click(screen.getByRole('button', { name: /复制/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('要复制的内容'))
  })

  // P1: 气泡「重新生成」重新触发 streamChat
  it('re-sends the last user question when regenerate is clicked', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => {
      onToken('回答', 'content')
      return { text: '回答', truncated: false, usedChars: 10, totalChars: 10 }
    })
    ;(window as any).api = makeApi({ streamChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: '初始问题' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await screen.findByText('回答')

    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2))
  })

  // Critical 回归：重新生成必须用 replaceChat 整体重写（丢弃旧回答），而非追加
  it('persists regeneration via replaceChat so the stale answer cannot resurface', async () => {
    const replaceChat = vi.fn(async () => {})
    let n = 0
    const streamChat = vi.fn(async (_a: any, onToken: any) => {
      n += 1
      const text = n === 1 ? '旧答案' : '新答案'
      onToken(text, 'content')
      return { text, truncated: false, usedChars: 10, totalChars: 10 }
    })
    ;(window as any).api = makeApi({ streamChat, replaceChat })
    render(<ChatView paper={paper} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: '问题' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await screen.findByText('旧答案')

    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    await screen.findByText('新答案')
    // replaceChat 收到的最终消息只含 user + 新答案，绝不含旧答案
    await waitFor(() => expect(replaceChat).toHaveBeenCalled())
    const lastCall = replaceChat.mock.calls.at(-1) as unknown as [string, Array<{ role: string; content: string }>]
    const msgs = lastCall[1]
    expect(msgs.some(m => m.content === '旧答案')).toBe(false)
    expect(msgs.some(m => m.role === 'user' && m.content === '问题')).toBe(true)
    expect(msgs.some(m => m.role === 'assistant' && m.content === '新答案')).toBe(true)
  })

  // I2 回归：切到另一篇论文时，旧对话清空并按新 key 重新加载
  it('clears old history and reloads when switching papers', async () => {
    const loadChat = vi.fn(async (key: string) =>
      key === 'P1'
        ? [{ id: 1, paperKey: 'P1', role: 'user' as const, content: '论文一的提问', reasoning: null, createdAt: 1 }]
        : [{ id: 2, paperKey: 'P2', role: 'user' as const, content: '论文二的提问', reasoning: null, createdAt: 1 }])
    ;(window as any).api = makeApi({ loadChat })
    const { rerender } = render(<ChatView paper={paper} />)
    expect(await screen.findByText('论文一的提问')).toBeInTheDocument()

    const paper2 = { key: 'P2', title: 'T2', authors: ['B'], year: 2021, abstract: '', attachmentKey: null }
    rerender(<ChatView paper={paper2} />)
    await waitFor(() => expect(loadChat).toHaveBeenCalledWith('P2'))
    expect(await screen.findByText('论文二的提问')).toBeInTheDocument()
    expect(screen.queryByText('论文一的提问')).not.toBeInTheDocument()
  })

  // P0: 「清空对话」调 clearChat
  it('calls clearChat and clears history when clear button is clicked', async () => {
    const clearChat = vi.fn(async () => {})
    ;(window as any).api = makeApi({
      loadChat: vi.fn(async () => [
        { id: 1, paperKey: 'P1', role: 'user' as const, content: '旧消息', reasoning: null, createdAt: 1 },
      ]),
      clearChat,
    })
    render(<ChatView paper={paper} />)
    await screen.findByText('旧消息')

    fireEvent.click(screen.getByRole('button', { name: /清空对话/ }))
    await waitFor(() => expect(clearChat).toHaveBeenCalledWith('P1'))
    await waitFor(() => expect(screen.queryByText('旧消息')).not.toBeInTheDocument())
  })
})
