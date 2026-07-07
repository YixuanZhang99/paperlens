import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'

const tables = (db: InstanceType<typeof Database>) =>
  new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map(r => r.name))

describe('lib_* tables migration', () => {
  it('creates lib_papers / lib_folders / lib_paper_folders', () => {
    const db = new Database(':memory:')
    migrate(db)
    const t = tables(db)
    expect(t.has('lib_papers')).toBe(true)
    expect(t.has('lib_folders')).toBe(true)
    expect(t.has('lib_paper_folders')).toBe(true)
  })

  it('is idempotent (migrate twice keeps data)', () => {
    const db = new Database(':memory:')
    migrate(db)
    db.prepare(`INSERT INTO lib_papers (key, title, authors, abstract, created_at) VALUES ('P1','T','[]','',1)`).run()
    migrate(db)
    expect((db.prepare('SELECT COUNT(*) AS n FROM lib_papers').get() as { n: number }).n).toBe(1)
  })

  it('lib_paper_folders dedups by composite primary key', () => {
    const db = new Database(':memory:')
    migrate(db)
    db.prepare(`INSERT OR IGNORE INTO lib_paper_folders (paper_key, folder_id) VALUES ('P1','F1')`).run()
    db.prepare(`INSERT OR IGNORE INTO lib_paper_folders (paper_key, folder_id) VALUES ('P1','F1')`).run()
    expect((db.prepare('SELECT COUNT(*) AS n FROM lib_paper_folders').get() as { n: number }).n).toBe(1)
  })
})
