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

  it('add-by-ref: fetches metadata, refreshes list and selects the new paper', async () => {
    const added = { key: 'NEW1', title: 'Attention Is All You Need', authors: ['Vaswani'], year: 2017, abstract: '', attachmentKey: null }
    let hasNew = false
    const listPapers = vi.fn(async () => (hasNew ? [...papers, added] : papers))
    const addPaperByRef = vi.fn(async () => { hasNew = true; return { paper: added, pdf: true } })
    ;(window as any).api = baseApi({ listPapers, addPaperByRef })
    const onSelect = vi.fn()
    render(<LibraryView onSelect={onSelect} selectedKey={null} />)
    await screen.findByText('Transformer')

    fireEvent.click(screen.getByTitle(/添加论文/))
    fireEvent.change(screen.getByPlaceholderText(/粘贴 DOI/), { target: { value: '1706.03762' } })
    fireEvent.click(screen.getByRole('button', { name: '获取并加入' }))

    await waitFor(() => expect(addPaperByRef).toHaveBeenCalledWith('1706.03762'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(added))
    expect(await screen.findByText(/PDF 已自动下载/)).toBeInTheDocument()
    // 列表已刷新出现新论文
    expect(await screen.findByText('Attention Is All You Need')).toBeInTheDocument()
  })

  it('add-by-ref failure shows error and opens the manual form as fallback', async () => {
    const addPaperByRef = vi.fn(async () => { throw new Error('arXiv 查询失败: 503') })
    const addPaperManual = vi.fn(async () => ({ key: 'M1', title: '手填论文', authors: [], year: null, abstract: '', attachmentKey: null }))
    ;(window as any).api = baseApi({ addPaperByRef, addPaperManual })
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)
    await screen.findByText('Transformer')

    fireEvent.click(screen.getByTitle(/添加论文/))
    fireEvent.change(screen.getByPlaceholderText(/粘贴 DOI/), { target: { value: '10.1/x' } })
    fireEvent.click(screen.getByRole('button', { name: '获取并加入' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/503/))
    // 手动表单自动展开,填标题提交
    fireEvent.change(await screen.findByPlaceholderText(/标题（必填）/), { target: { value: '手填论文' } })
    fireEvent.click(screen.getAllByRole('button', { name: '加入文献库' }).at(-1)!)
    await waitFor(() => expect(addPaperManual).toHaveBeenCalledWith(
      expect.objectContaining({ title: '手填论文' })))
  })

  it('drop-a-PDF flow: sniffs title, then addManual + attachPdf on confirm', async () => {
    const sniffPdf = vi.fn(async () => ({ titleGuess: 'Sniffed Title' }))
    const addPaperManual = vi.fn(async () => ({ key: 'PD1', title: 'Sniffed Title', authors: [], year: null, abstract: '', attachmentKey: null }))
    const attachPaperPdf = vi.fn(async () => undefined)
    ;(window as any).api = baseApi({ sniffPdf, addPaperManual, attachPaperPdf })
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)
    await screen.findByText('Transformer')

    fireEvent.click(screen.getByTitle(/添加论文/))
    const file = new File([new Uint8Array([1, 2, 3])], 'x.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
    const input = screen.getByLabelText(/选择 PDF 文件/) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(sniffPdf).toHaveBeenCalled())
    const titleInput = await screen.findByDisplayValue('Sniffed Title')
    fireEvent.change(titleInput, { target: { value: 'Final Title' } })
    fireEvent.click(screen.getByRole('button', { name: '加入文献库' }))
    await waitFor(() => expect(addPaperManual).toHaveBeenCalledWith(expect.objectContaining({ title: 'Final Title' })))
    await waitFor(() => expect(attachPaperPdf).toHaveBeenCalledWith('PD1', expect.anything()))
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
