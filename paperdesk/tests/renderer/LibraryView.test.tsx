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

// 所有用例的公共 mock(migrateStatus 组件挂载即调)
const baseApi = (overrides: Record<string, unknown> = {}) => ({
  listPapers: vi.fn(async () => papers),
  listCollections: vi.fn(async () => []),
  migrateStatus: vi.fn(async () => ({ hasPaperLens: false, zoteroConfigured: true, paperCount: papers.length })),
  migrateRun: vi.fn(),
  ...overrides,
})

describe('LibraryView', () => {
  it('lists papers from api and notifies on click', async () => {
    ;(window as any).api = baseApi()
    const onSelect = vi.fn()
    render(<LibraryView onSelect={onSelect} selectedKey={null} />)

    expect(await screen.findByText('Transformer')).toBeInTheDocument()
    expect(screen.getByText('BERT')).toBeInTheDocument()

    fireEvent.click(screen.getByText('BERT'))
    expect(onSelect).toHaveBeenCalledWith(papers[1])
  })

  it('shows an error message when loading fails', async () => {
    ;(window as any).api = baseApi({ listPapers: vi.fn(async () => { throw new Error('403') }) })
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/加载失败/))
  })

  it('renders the collection tree (nested folders) and filters papers by folder', async () => {
    const listPapers = vi.fn(async (col?: string | null) =>
      col === 'C1' ? [papers[0]] : papers)
    ;(window as any).api = baseApi({ listPapers, listCollections: vi.fn(async () => collections) })
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)

    expect(await screen.findByText('BERT')).toBeInTheDocument()
    fireEvent.click(await screen.findByTitle('切换文件夹'))

    expect(await screen.findByRole('button', { name: /机器学习/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /LLM/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /机器学习/ }))
    await waitFor(() => expect(listPapers).toHaveBeenCalledWith('C1'))
    await waitFor(() => expect(screen.queryByText('BERT')).not.toBeInTheDocument())
    expect(screen.getByText('Transformer')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('切换文件夹'))
    fireEvent.click(await screen.findByRole('button', { name: /全部论文/ }))
    await waitFor(() => expect(listPapers).toHaveBeenLastCalledWith(null))
    expect(await screen.findByText('BERT')).toBeInTheDocument()
  })

  it('empty library shows one-click migrate; running it reports progress and reloads', async () => {
    let migrated = false
    const listPapers = vi.fn(async () => (migrated ? papers : []))
    const migrateRun = vi.fn(async (onProgress: (p: string, d: number, t: number, l: string) => void) => {
      onProgress('paperlens', 1, 1, 'PaperLens 数据搬迁完成')
      onProgress('zotero', 2, 2, '论文乙')
      migrated = true
      return { fromPaperLens: true, zoteroConfigured: true, papers: 2, folders: 1, pdfs: 1, pdfMissing: 1 }
    })
    ;(window as any).api = baseApi({
      listPapers,
      migrateStatus: vi.fn(async () => ({ hasPaperLens: true, zoteroConfigured: true, paperCount: 0 })),
      migrateRun,
    })
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)

    // 空库 → 显示检测提示与一键迁移按钮
    expect(await screen.findByText('文献库是空的')).toBeInTheDocument()
    expect(await screen.findByText(/检测到旧 PaperLens/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /一键迁移/ }))

    await waitFor(() => expect(migrateRun).toHaveBeenCalledTimes(1))
    // 完成后重新加载列表,论文出现
    expect(await screen.findByText('Transformer')).toBeInTheDocument()
  })

  it('empty library without Zotero config hints to fill settings first', async () => {
    ;(window as any).api = baseApi({
      listPapers: vi.fn(async () => []),
      migrateStatus: vi.fn(async () => ({ hasPaperLens: false, zoteroConfigured: false, paperCount: 0 })),
    })
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)
    expect(await screen.findByText(/请先到「设置」填写 Zotero/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /从 Zotero 导入文献/ })).toBeInTheDocument()
  })
})
