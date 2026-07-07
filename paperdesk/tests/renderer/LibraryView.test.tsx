import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LibraryView } from '../../src/renderer/components/LibraryView'

const papers = [
  { key: 'P1', title: 'Transformer', authors: ['Vaswani'], year: 2017, abstract: '', attachmentKey: null },
  { key: 'P2', title: 'BERT', authors: ['Devlin'], year: 2018, abstract: '', attachmentKey: null },
]
const collections = [
  { key: 'C1', name: '机器学习', parentKey: null },
  { key: 'C2', name: 'LLM', parentKey: 'C1' },
]

describe('LibraryView', () => {
  it('lists papers from api and notifies on click', async () => {
    ;(window as any).api = {
      listPapers: vi.fn(async () => papers),
      listCollections: vi.fn(async () => []),
    }
    const onSelect = vi.fn()
    render(<LibraryView onSelect={onSelect} selectedKey={null} />)

    expect(await screen.findByText('Transformer')).toBeInTheDocument()
    expect(screen.getByText('BERT')).toBeInTheDocument()

    fireEvent.click(screen.getByText('BERT'))
    expect(onSelect).toHaveBeenCalledWith(papers[1])
  })

  it('shows an error message when loading fails', async () => {
    ;(window as any).api = {
      listPapers: vi.fn(async () => { throw new Error('403') }),
      listCollections: vi.fn(async () => []),
    }
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/加载失败/))
  })

  it('renders the Zotero collection tree (nested folders) and filters papers by folder', async () => {
    const listPapers = vi.fn(async (col?: string | null) =>
      col === 'C1' ? [papers[0]] : papers)
    ;(window as any).api = {
      listPapers,
      listCollections: vi.fn(async () => collections),
    }
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)

    expect(await screen.findByText('BERT')).toBeInTheDocument()
    // 文件夹树默认收起，点「当前文件夹」展开
    fireEvent.click(await screen.findByTitle('切换文件夹'))

    // 文件夹树渲染（含嵌套子文件夹）
    expect(await screen.findByRole('button', { name: /机器学习/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /LLM/ })).toBeInTheDocument()

    // 点文件夹 → 按该 collection 过滤（选完树自动收起）
    fireEvent.click(screen.getByRole('button', { name: /机器学习/ }))
    await waitFor(() => expect(listPapers).toHaveBeenCalledWith('C1'))
    await waitFor(() => expect(screen.queryByText('BERT')).not.toBeInTheDocument())
    expect(screen.getByText('Transformer')).toBeInTheDocument()

    // 重新展开 → 选「全部论文」取消过滤
    fireEvent.click(screen.getByTitle('切换文件夹'))
    fireEvent.click(await screen.findByRole('button', { name: /全部论文/ }))
    await waitFor(() => expect(listPapers).toHaveBeenLastCalledWith(null))
    expect(await screen.findByText('BERT')).toBeInTheDocument()
  })
})
