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
  listCollections: vi.fn(async () => [{ key: 'C1', name: '对齐研究' }]),
  deleteNote: vi.fn(async () => undefined),
  addNote: vi.fn(async (_n: { paperKey: string; content: string; tags: string[]; autoTag?: boolean }) =>
    ({ id: 'n9', paperKey: 'P1', content: '', tags: [], createdAt: 3, notionPageId: null })),
  kbAsk: vi.fn(),
  kbReview: vi.fn(),
  syncNote: vi.fn(async () => 'notion-pg-1'),
})

// 标准 kbAsk mock：流式两段 token 后 resolve 含 chunks 的来源
const okAsk = () =>
  vi.fn(async (_args: any, onToken: any) => {
    onToken('根据库内论文，', 'content')
    onToken('RLHF 是…[来源1]', 'content')
    return {
      answer: '根据库内论文，RLHF 是…[来源1]',
      sources: [{ paperKey: 'P1', paperTitle: 'RLHF 论文', chunks: [{ text: '原文片段甲', page: 7 }] }],
      followups: [],
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
    fireEvent.click(chip) // chip 点击只展开，不跳转
    expect(onOpenPaper).not.toHaveBeenCalled()
    // 引文带页码徽标，点击引文跳到该页并把片段前缀作为高亮 quote
    const pageLabel = await screen.findByText(/第7页/)
    const quote = pageLabel.closest('.kb-quote') as HTMLElement
    expect(quote.textContent).toContain('原文片段甲')
    fireEvent.click(quote)
    expect(onOpenPaper).toHaveBeenCalledWith('P1', 7, '原文片段甲')
    // 「打开论文 →」按钮不带页码（整篇打开）
    const panel = quote.closest('.kb-source-panel') as HTMLElement
    fireEvent.click(within(panel).getByRole('button', { name: /打开论文/ }))
    expect(onOpenPaper).toHaveBeenCalledWith('P1')
    // 再点 chip 收起
    fireEvent.click(chip)
    await waitFor(() => expect(screen.queryByText(/第7页/)).not.toBeInTheDocument())
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

  it('passes the selected collection scope and renders followup chips that re-ask within scope', async () => {
    const api = baseApi()
    api.kbAsk = vi.fn(async (_args: any, onToken: any) => {
      onToken('答案A', 'content')
      return {
        answer: '答案A',
        sources: [{ paperKey: 'P1', paperTitle: 'RLHF 论文', chunks: [{ text: '片段', page: 1 }] }],
        followups: ['它们效果如何？', '有公开实现吗？'],
      }
    })
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    // 等 collections 加载后选范围「对齐研究」(C1)
    await screen.findByRole('option', { name: '对齐研究' })
    fireEvent.change(screen.getByTitle(/限定问答检索范围/), { target: { value: 'C1' } })
    // 选范围后占位符变化，用新占位符定位输入框
    fireEvent.change(screen.getByPlaceholderText(/在所选文件夹内提问/), { target: { value: 'RLHF 是什么' } })
    fireEvent.click(screen.getByRole('button', { name: '提问' }))
    await waitFor(() => expect(api.kbAsk).toHaveBeenCalledTimes(1))
    expect(api.kbAsk.mock.calls[0][0].collectionKey).toBe('C1')
    // 追问 chip 出现，点击触发第二次提问，且范围仍为 C1
    const chip = await screen.findByRole('button', { name: '它们效果如何？' })
    fireEvent.click(chip)
    await waitFor(() => expect(api.kbAsk).toHaveBeenCalledTimes(2))
    expect(api.kbAsk.mock.calls[1][0].question).toBe('它们效果如何？')
    expect(api.kbAsk.mock.calls[1][0].collectionKey).toBe('C1')
  })

  it('syncs a KB note to Notion with full paper metadata and then shows the synced badge', async () => {
    const api = baseApi()
    let synced = false
    api.syncNote = vi.fn(async () => { synced = true; return 'pg1' })
    api.listAllNotes = vi.fn(async () => synced ? notes.map(n => (n.id === 'n1' ? { ...n, notionPageId: 'pg1' } : n)) : notes)
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    const card = (await screen.findByText('关于RLHF的笔记')).closest('li') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /同步到 Notion/ }))
    // 传完整 Paper（非仅标题）给 notes:sync
    await waitFor(() => expect(api.syncNote).toHaveBeenCalledWith({ noteId: 'n1', paper: expect.objectContaining({ key: 'P1', title: 'RLHF 论文' }) }))
    // 同步后显示徽标
    await waitFor(() => expect(screen.getByText(/已同步 Notion/)).toBeInTheDocument())
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

  it('review confirm flow: shows confirm on first click, calls kbReview on confirm', async () => {
    const api = baseApi()
    api.kbReview = vi.fn(async () => ({ content: '综述内容', papers: 2, skipped: 0 }))
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    // 切到「索引状态」tab
    fireEvent.click(await screen.findByRole('button', { name: /索引状态/ }))
    // 首次点击「生成综述」→ 出现「确认生成」，kbReview 未调
    fireEvent.click(await screen.findByRole('button', { name: '生成综述' }))
    expect(await screen.findByRole('button', { name: '确认生成' })).toBeInTheDocument()
    expect(api.kbReview).not.toHaveBeenCalled()
    // 点「确认生成」→ kbReview 被调，collectionKey 为 null（全部论文）
    fireEvent.click(screen.getByRole('button', { name: '确认生成' }))
    await waitFor(() => expect(api.kbReview).toHaveBeenCalledTimes(1))
    expect(api.kbReview.mock.calls[0][0]).toMatchObject({ collectionKey: null })
  })

  it('review streaming preview: onToken triggers preview, completion shows content', async () => {
    const api = baseApi()
    api.kbReview = vi.fn(async (_args: any, _onProgress: any, onToken: any) => {
      onToken('综述内容', 'content')
      return { content: '综述内容', papers: 2, skipped: 0 }
    })
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /索引状态/ }))
    fireEvent.click(await screen.findByRole('button', { name: '生成综述' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认生成' }))
    await waitFor(() => expect(screen.getByText('综述内容')).toBeInTheDocument())
  })

  it('review save as note: after completion, clicking save calls addNote with review content', async () => {
    const api = baseApi()
    api.kbReview = vi.fn(async (_args: any, _onProgress: any, onToken: any) => {
      onToken('综述内容正文', 'content')
      return { content: '综述内容正文', papers: 2, skipped: 0 }
    })
    ;(window as any).api = api
    render(<KnowledgeView onOpenPaper={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /索引状态/ }))
    fireEvent.click(await screen.findByRole('button', { name: '生成综述' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认生成' }))
    // 等待「存为笔记」按钮出现
    const saveBtn = await screen.findByRole('button', { name: '存为笔记' })
    fireEvent.click(saveBtn)
    await waitFor(() => expect(api.addNote).toHaveBeenCalledTimes(1))
    const arg = api.addNote.mock.calls[0][0]
    expect(arg.content).toContain('文献综述')
    expect(arg.autoTag).toBe(true)
    // 按钮变「已存为笔记」
    await waitFor(() => expect(screen.getByRole('button', { name: /已存为笔记/ })).toBeInTheDocument())
  })
})
