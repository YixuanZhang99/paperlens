import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { createLibraryRepo, type LibraryRepo } from '../../src/main/services/library-repo'
import { importFromZotero } from '../../src/main/services/zotero-import'
import type { Paper, ZoteroCollection } from '@shared/types'

const P = (key: string, title: string): Paper => ({ key, title, authors: ['A'], year: 2024, abstract: '', attachmentKey: null })

let db: InstanceType<typeof Database>
let repo: LibraryRepo

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  repo = createLibraryRepo({ db })
})

function makeDeps(overrides: Partial<Parameters<typeof importFromZotero>[0]> = {}) {
  const papers = [P('K1', '论文甲'), P('K2', '论文乙')]
  const cols: ZoteroCollection[] = [
    { key: 'C1', name: '文件夹一', parentKey: null },
    { key: 'C2', name: '子文件夹', parentKey: 'C1' },
  ]
  const byCol: Record<string, Paper[]> = { C1: [papers[0]], C2: [papers[0], papers[1]] }
  const written: Array<{ key: string; bytes: Uint8Array }> = []
  const deps = {
    repo,
    zotero: {
      listPapers: vi.fn(async (col?: string | null) => (col ? byCol[col] ?? [] : papers)),
      listCollections: vi.fn(async () => cols),
      findPdfAttachmentInfo: vi.fn(async (k: string) => (k === 'K1' ? { key: 'ATT1', filename: 'a.pdf' } : null)),
      downloadAttachment: vi.fn(async () => new Float32Array([1]).buffer as ArrayBuffer),
    },
    zoteroLocal: { readPdf: vi.fn((attKey: string) => (attKey === 'ATT1' ? new Uint8Array([1, 2, 3]) : null)) },
    writePdf: vi.fn((key: string, bytes: Uint8Array) => { written.push({ key, bytes }); return `${key}.pdf` }),
    onProgress: vi.fn(),
    ...overrides,
  }
  return { deps, written }
}

describe('importFromZotero', () => {
  it('imports papers (key preserved), folders (hierarchy), memberships, and PDFs from local', async () => {
    const { deps, written } = makeDeps()
    const r = await importFromZotero(deps)
    expect(r.papers).toBe(2)
    expect(r.folders).toBe(2)
    expect(r.pdfs).toBe(1)          // 仅 K1 有附件
    expect(r.pdfMissing).toBe(1)    // K2 无附件
    // key 沿用
    expect(repo.listPapers().map(p => p.key).sort()).toEqual(['K1', 'K2'])
    // 文件夹层级
    const folders = repo.listFolders().sort((a, b) => a.key.localeCompare(b.key))
    expect(folders).toEqual([
      { key: 'C1', name: '文件夹一', parentKey: null },
      { key: 'C2', name: '子文件夹', parentKey: 'C1' },
    ])
    // 多归属:K1 同时在 C1/C2
    expect(repo.listPapers('C1').map(p => p.key)).toEqual(['K1'])
    expect(repo.listPapers('C2').map(p => p.key).sort()).toEqual(['K1', 'K2'])
    // PDF:local 命中,写盘且不走 web
    expect(written).toHaveLength(1)
    expect(Array.from(written[0].bytes)).toEqual([1, 2, 3])
    expect(deps.zotero.downloadAttachment).not.toHaveBeenCalled()
    expect(repo.getPdfFile('K1')).toBe('K1.pdf')
    expect(repo.getPdfFile('K2')).toBeNull()
  })

  it('falls back to web download when local storage misses', async () => {
    const { deps } = makeDeps({ zoteroLocal: { readPdf: vi.fn(() => null) } })
    const r = await importFromZotero(deps)
    expect(deps.zotero.downloadAttachment).toHaveBeenCalledWith('ATT1')
    expect(r.pdfs).toBe(1)
  })

  it('is idempotent (second run does not duplicate) and reports progress', async () => {
    const { deps } = makeDeps()
    await importFromZotero(deps)
    await importFromZotero(deps)
    expect(repo.countPapers()).toBe(2)
    expect(repo.listPapers('C2').length).toBe(2)
    expect(deps.onProgress).toHaveBeenCalled()
  })
})
