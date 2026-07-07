import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { createLibraryRepo, type LibraryRepo } from '../../src/main/services/library-repo'

let db: InstanceType<typeof Database>
let repo: LibraryRepo

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  repo = createLibraryRepo({ db })
})

const p1 = { key: 'P1', title: '论文一', authors: ['张三', '李四'], year: 2024, abstract: '摘要一', createdAt: 100 }
const p2 = { key: 'P2', title: '论文二', authors: [], year: null, abstract: '', doi: '10.1/x', createdAt: 200 }

describe('papers', () => {
  it('upsertPaper + listPapers maps to Paper shape, newest first', () => {
    repo.upsertPaper(p1)
    repo.upsertPaper(p2)
    const ps = repo.listPapers()
    expect(ps.map(p => p.key)).toEqual(['P2', 'P1']) // created_at DESC
    expect(ps[1]).toEqual({ key: 'P1', title: '论文一', authors: ['张三', '李四'], year: 2024, abstract: '摘要一', attachmentKey: null })
  })

  it('upsert is idempotent and updates fields', () => {
    repo.upsertPaper(p1)
    repo.upsertPaper({ ...p1, title: '新标题' })
    expect(repo.countPapers()).toBe(1)
    expect(repo.listPapers()[0].title).toBe('新标题')
  })

  it('setPaperPdf + getPdfFile round-trip; missing → null', () => {
    repo.upsertPaper(p1)
    expect(repo.getPdfFile('P1')).toBeNull()
    repo.setPaperPdf('P1', 'P1.pdf')
    expect(repo.getPdfFile('P1')).toBe('P1.pdf')
    expect(repo.getPdfFile('NOPE')).toBeNull()
  })
})

describe('folders', () => {
  it('upsertFolder + listFolders maps to ZoteroCollection shape (key/name/parentKey)', () => {
    repo.upsertFolder({ id: 'F1', name: '顶层' })
    repo.upsertFolder({ id: 'F2', name: '子层', parentId: 'F1' })
    const fs = repo.listFolders().sort((a, b) => a.key.localeCompare(b.key))
    expect(fs).toEqual([
      { key: 'F1', name: '顶层', parentKey: null },
      { key: 'F2', name: '子层', parentKey: 'F1' },
    ])
  })

  it('setPaperFolders is overwrite-style and filters listPapers by folder', () => {
    repo.upsertPaper(p1); repo.upsertPaper(p2)
    repo.upsertFolder({ id: 'F1', name: 'A' }); repo.upsertFolder({ id: 'F2', name: 'B' })
    repo.setPaperFolders('P1', ['F1', 'F2'])
    expect(repo.listPapers('F1').map(p => p.key)).toEqual(['P1'])
    repo.setPaperFolders('P1', ['F2']) // 覆盖
    expect(repo.listPapers('F1')).toEqual([])
    expect(repo.listPapers('F2').map(p => p.key)).toEqual(['P1'])
    expect(repo.listPapers(null).length).toBe(2) // null=全部
  })
})

describe('management (L3)', () => {
  it('updatePaper edits metadata but keeps pdf_path and created_at', () => {
    repo.upsertPaper({ ...p1, pdfPath: 'P1.pdf' })
    repo.updatePaper('P1', { title: '改后', authors: ['王五'], year: 2020, abstract: '新摘要', doi: '10.9/z' })
    const p = repo.listPapers()[0]
    expect(p.title).toBe('改后')
    expect(p.authors).toEqual(['王五'])
    expect(p.year).toBe(2020)
    expect(repo.getPdfFile('P1')).toBe('P1.pdf') // 不被 update 抹掉
  })

  it('updatePaper cascades the new title into chunks.paper_title (KB source chips)', () => {
    repo.upsertPaper(p1)
    db.prepare(`INSERT INTO chunks (paper_key, paper_title, seq, text, page_index) VALUES ('P1','论文一',0,'内容',1)`).run()
    repo.updatePaper('P1', { title: '新标题', authors: [], year: null, abstract: '' })
    expect((db.prepare(`SELECT paper_title FROM chunks WHERE paper_key='P1'`).get() as { paper_title: string }).paper_title).toBe('新标题')
  })

  it('getPaperByKey returns the mapped paper or null', () => {
    repo.upsertPaper(p1)
    expect(repo.getPaperByKey('P1')?.title).toBe('论文一')
    expect(repo.getPaperByKey('NOPE')).toBeNull()
  })

  it('deletePaper removes the paper and its folder memberships', () => {
    repo.upsertPaper(p1)
    repo.upsertFolder({ id: 'F1', name: 'A' })
    repo.setPaperFolders('P1', ['F1'])
    repo.deletePaper('P1')
    expect(repo.countPapers()).toBe(0)
    expect(repo.getPaperFolders('P1')).toEqual([])
  })

  it('addFolder generates an id and returns collection shape; child under parent', () => {
    const top = repo.addFolder({ name: '新文件夹' })
    expect(top.key).toMatch(/^[A-Z0-9]{8}$/)
    expect(top).toMatchObject({ name: '新文件夹', parentKey: null })
    const child = repo.addFolder({ name: '子', parentId: top.key })
    expect(child.parentKey).toBe(top.key)
  })

  it('renameFolder renames; deleteFolder lifts children one level and clears memberships', () => {
    const a = repo.addFolder({ name: 'A' })
    const b = repo.addFolder({ name: 'B', parentId: a.key })
    const c = repo.addFolder({ name: 'C', parentId: b.key })
    repo.upsertPaper(p1)
    repo.setPaperFolders('P1', [b.key])
    repo.renameFolder(b.key, 'B2')
    expect(repo.listFolders().find(f => f.key === b.key)?.name).toBe('B2')
    repo.deleteFolder(b.key)
    const folders = repo.listFolders()
    expect(folders.find(f => f.key === b.key)).toBeUndefined()
    expect(folders.find(f => f.key === c.key)?.parentKey).toBe(a.key) // C 上提到 A 下
    expect(repo.getPaperFolders('P1')).toEqual([]) // 归属清掉
  })

  it('getPaperFolders returns current membership ids', () => {
    repo.upsertPaper(p1)
    repo.upsertFolder({ id: 'F1', name: 'A' }); repo.upsertFolder({ id: 'F2', name: 'B' })
    repo.setPaperFolders('P1', ['F1', 'F2'])
    expect(repo.getPaperFolders('P1').sort()).toEqual(['F1', 'F2'])
  })
})
