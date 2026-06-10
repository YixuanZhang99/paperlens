import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KnowledgeView } from '../../src/renderer/components/KnowledgeView'

const notes = [
  { id: 'n1', paperKey: 'P1', content: '关于RLHF的笔记', tags: ['对齐'], createdAt: 2, notionPageId: null },
  { id: 'n2', paperKey: 'P2', content: '蒸馏方法笔记', tags: ['压缩'], createdAt: 1, notionPageId: null },
]
const baseApi = () => ({
  kbStatus: vi.fn(async () => ({ indexedPapers: 2, totalPapers: 19, totalChunks: 120 })),
  kbIndex: vi.fn(async () => ({ indexed: 0, skipped: 0 })),
  listAllNotes: vi.fn(async () => notes),
  kbAsk: vi.fn(),
})

describe('KnowledgeView', () => {
  it('asks the library and renders streamed answer + clickable sources', async () => {
    const api = baseApi()
    api.kbAsk = vi.fn(async (_q: string, onToken: any) => {
      onToken('根据库内论文，', 'content'); onToken('RLHF 是…[来源1]', 'content')
      return { answer: '根据库内论文，RLHF 是…[来源1]', sources: [{ paperKey: 'P1', title: 'RLHF 论文' }] }
    })
    ;(window as any).api = api
    const onOpenPaper = vi.fn()
    render(<KnowledgeView onOpenPaper={onOpenPaper} />)
    fireEvent.change(screen.getByPlaceholderText(/向整个论文库提问/), { target: { value: 'RLHF 是什么' } })
    fireEvent.click(screen.getByRole('button', { name: '提问' }))
    expect(await screen.findByText(/RLHF 是…/)).toBeInTheDocument()
    const src = await screen.findByRole('button', { name: /RLHF 论文/ })
    fireEvent.click(src)
    expect(onOpenPaper).toHaveBeenCalledWith('P1')
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
})
