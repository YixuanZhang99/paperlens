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
