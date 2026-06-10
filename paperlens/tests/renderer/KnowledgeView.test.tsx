import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { KnowledgeView } from '../../src/renderer/components/KnowledgeView'

const notes = [
  { id: 'n1', paperKey: 'P1', content: '关于RLHF的笔记', tags: ['对齐'], createdAt: 2, notionPageId: null },
  { id: 'n2', paperKey: 'P2', content: '蒸馏方法笔记', tags: ['压缩'], createdAt: 1, notionPageId: null },
]
const baseApi = () => ({
  kbStatus: vi.fn(async () => ({ indexedPapers: 2, totalPapers: 19, totalChunks: 120 })),
  kbIndex: vi.fn(async () => ({ indexed: 0, skipped: 0 })),
  listAllNotes: vi.fn(async () => notes),
  listPapers: vi.fn(async () => [{ key: 'P1', title: 'RLHF 论文', authors: '', year: 2024, abstract: '' }]),
  deleteNote: vi.fn(async () => undefined),
  addNote: vi.fn(async (_n: { paperKey: string; content: string; tags: string[]; autoTag?: boolean }) =>
    ({ id: 'n9', paperKey: 'P1', content: '', tags: [], createdAt: 3, notionPageId: null })),
  kbAsk: vi.fn(),
})

// 标准 kbAsk mock：流式两段 token 后 resolve 含 chunks 的来源
const okAsk = () =>
  vi.fn(async (_args: any, onToken: any) => {
    onToken('根据库内论文，', 'content')
    onToken('RLHF 是…[来源1]', 'content')
    return {
      answer: '根据库内论文，RLHF 是…[来源1]',
      sources: [{ paperKey: 'P1', paperTitle: 'RLHF 论文', chunks: ['原文片段甲'] }],
    }
  })

async function askOnce(q: string) {
  fireEvent.change(screen.getByPlaceholderText(/向整个论文库提问/), { target: { value: q } })
  fireEvent.click(screen.getByRole('button', { name: '提问' }))
}

beforeEach(() => {
  localStorage.clear()
})

describe('KnowledgeView', () => {
  it('runs multi-turn Q&A: second ask carries the first turn as history', async () => {
    const api = baseApi()
    api.kbAsk = okAsk()
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    await askOnce('RLHF 是什么')
    await waitFor(() => expect(screen.getByText(/RLHF 是…/)).toBeInTheDocument())
    await askOnce('它的奖励模型怎么训练')
    await waitFor(() => expect(api.kbAsk).toHaveBeenCalledTimes(2))
    const second = api.kbAsk.mock.calls[1][0]
    expect(second.question).toBe('它的奖励模型怎么训练')
    expect(second.history).toEqual([
      { role: 'user', content: 'RLHF 是什么' },
      { role: 'assistant', content: '根据库内论文，RLHF 是…[来源1]' },
    ])
    // 两轮都留在线程里
    await waitFor(() => expect(screen.getByText('RLHF 是什么')).toBeInTheDocument())
    expect(screen.getByText('它的奖励模型怎么训练')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/RLHF 是…/).length).toBe(2))
  })

  it('expands a source chip to show chunk quotes and opens the paper from the panel', async () => {
    const api = baseApi()
    api.kbAsk = okAsk()
    ;(window as any).api = api
    const onOpenPaper = vi.fn()
    render(<KnowledgeView onOpenPaper={onOpenPaper} />)
    await askOnce('RLHF 是什么')
    const chip = await screen.findByRole('button', { name: /\[来源1\] RLHF 论文/ })
    fireEvent.click(chip) // chip 点击不再直接跳转
    expect(onOpenPaper).not.toHaveBeenCalled()
    const quote = await screen.findByText('原文片段甲')
    const panel = quote.closest('.kb-source-panel') as HTMLElement
    fireEvent.click(within(panel).getByRole('button', { name: /打开论文/ }))
    expect(onOpenPaper).toHaveBeenCalledWith('P1')
    // 再点 chip 收起
    fireEvent.click(chip)
    await waitFor(() => expect(screen.queryByText('原文片段甲')).not.toBeInTheDocument())
  })

  it('persists turns across remount via localStorage and clears them with the clear button', async () => {
    const api = baseApi()
    api.kbAsk = okAsk()
    ;(window as any).api = api
    const first = render(<KnowledgeView onOpenPaper={vi.fn()} />)
    await askOnce('RLHF 是什么')
    await waitFor(() => expect(screen.getByText(/RLHF 是…/)).toBeInTheDocument())
    first.unmount()
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('RLHF 是什么')).toBeInTheDocument())
    expect(screen.getByText(/RLHF 是…/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /清空对话/ }))
    await waitFor(() => expect(screen.queryByText('RLHF 是什么')).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem('pl.kb.turns') || '[]')).toEqual([])
  })

  it('saves a finished turn as a note and marks the button as saved', async () => {
    const api = baseApi()
    api.kbAsk = okAsk()
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    await askOnce('RLHF 是什么')
    fireEvent.click(await screen.findByRole('button', { name: '存为笔记' }))
    await waitFor(() => expect(api.addNote).toHaveBeenCalledTimes(1))
    const arg = api.addNote.mock.calls[0][0]
    expect(arg.paperKey).toBe('P1')
    expect(arg.content).toContain('RLHF 是什么')
    expect(arg.content).toContain('RLHF 论文')
    expect(arg.autoTag).toBe(true)
    const saved = await screen.findByRole('button', { name: /已存为笔记/ })
    expect(saved).toBeDisabled()
  })

  it('renders a graceful no-hit answer in the thread without an error alert', async () => {
    const api = baseApi()
    api.kbAsk = vi.fn(async () => ({
      answer: '知识库中没有检索到与这个问题相关的内容。可以换个问法，或到「索引状态」里更新索引后再试。',
      sources: [],
    }))
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    await askOnce('完全无关的问题')
    await waitFor(() => expect(screen.getByText(/知识库中没有检索到/)).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '存为笔记' })).not.toBeInTheDocument()
  })

  it('note cards show paper title + date, two-step delete, open-paper button, no card-level navigation', async () => {
    const api = baseApi()
    ;(window as any).api = api
    const onOpenPaper = vi.fn()
    render(<KnowledgeView onOpenPaper={onOpenPaper} />)
    const card = (await screen.findByText('关于RLHF的笔记')).closest('li') as HTMLElement
    expect(within(card).getByText('RLHF 论文')).toBeInTheDocument()
    expect(within(card).getByText(new Date(2).toLocaleDateString())).toBeInTheDocument()
    // P2 没在论文列表里 → 显示 paperKey
    const card2 = screen.getByText('蒸馏方法笔记').closest('li') as HTMLElement
    expect(within(card2).getByText('P2')).toBeInTheDocument()
    // 卡片本体点击不跳转
    fireEvent.click(card)
    expect(onOpenPaper).not.toHaveBeenCalled()
    // 打开论文按钮
    fireEvent.click(within(card).getByRole('button', { name: /打开论文/ }))
    expect(onOpenPaper).toHaveBeenCalledWith('P1')
    // 两步删除
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    expect(api.deleteNote).not.toHaveBeenCalled()
    const before = api.listAllNotes.mock.calls.length
    fireEvent.click(within(card).getByRole('button', { name: '确认删除？' }))
    await waitFor(() => expect(api.deleteNote).toHaveBeenCalledWith('n1'))
    await waitFor(() => expect(api.listAllNotes.mock.calls.length).toBeGreaterThan(before))
  })

  it('ignores Enter while IME is composing', async () => {
    const api = baseApi()
    api.kbAsk = okAsk()
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    const input = screen.getByPlaceholderText(/向整个论文库提问/)
    fireEvent.change(input, { target: { value: 'RLHF 是什么' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(api.kbAsk).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.kbAsk).toHaveBeenCalledTimes(1))
  })

  it('browses all notes and filters by tag chip', async () => {
    ;(window as any).api = baseApi()
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    expect(await screen.findByText('关于RLHF的笔记')).toBeInTheDocument()
    expect(screen.getByText('蒸馏方法笔记')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '对齐' }))
    await waitFor(() => expect(screen.queryByText('蒸馏方法笔记')).not.toBeInTheDocument())
    expect(screen.getByText('关于RLHF的笔记')).toBeInTheDocument()
  })

  it('shows index status and triggers re-index', async () => {
    const api = baseApi()
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /索引状态/ }))
    expect(await screen.findByText(/2 \/ 19/)).toBeInTheDocument()
    const before = api.kbIndex.mock.calls.length // 挂载已自动触发过一次
    fireEvent.click(screen.getByRole('button', { name: /更新索引/ }))
    await waitFor(() => expect(api.kbIndex.mock.calls.length).toBeGreaterThan(before))
  })

  it('persists notes-tab filters (tab/keyword/tag) across remount', async () => {
    ;(window as any).api = baseApi()
    const first = render(<KnowledgeView onOpenPaper={vi.fn()} />)
    fireEvent.change(await screen.findByPlaceholderText(/搜索笔记/), { target: { value: '蒸馏' } })
    fireEvent.click(screen.getByRole('button', { name: '压缩' }))
    await waitFor(() => expect(screen.queryByText('关于RLHF的笔记')).not.toBeInTheDocument())
    first.unmount()
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    expect(await screen.findByText('蒸馏方法笔记')).toBeInTheDocument()
    expect(screen.queryByText('关于RLHF的笔记')).not.toBeInTheDocument()
    expect((screen.getByPlaceholderText(/搜索笔记/) as HTMLInputElement).value).toBe('蒸馏')
  })
})
