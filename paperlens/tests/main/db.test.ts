import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'

describe('db.migrate', () => {
  it('creates notes and pdf_cache tables', () => {
    const db = new Database(':memory:')
    migrate(db)
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name)
    expect(tables).toContain('notes')
    expect(tables).toContain('pdf_cache')
  })

  it('is idempotent (safe to run twice)', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(() => migrate(db)).not.toThrow()
  })

  it('creates chunks table and chunks_fts with sync triggers', () => {
    const db = new Database(':memory:')
    migrate(db)
    db.prepare('INSERT INTO chunks (paper_key, paper_title, seq, text) VALUES (?,?,?,?)')
      .run('P1', '论文一', 0, '中期训练是预训练与微调之间的关键阶段')
    const hit = db.prepare(
      `SELECT c.paper_key FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH ?`
    ).all('"中期训练"')
    expect(hit).toEqual([{ paper_key: 'P1' }])
  })

  it('fts index follows chunk deletion', () => {
    const db = new Database(':memory:')
    migrate(db)
    db.prepare('INSERT INTO chunks (paper_key, paper_title, seq, text) VALUES (?,?,?,?)')
      .run('P1', 'T', 0, 'transformer attention mechanism')
    db.prepare('DELETE FROM chunks WHERE paper_key = ?').run('P1')
    const hit = db.prepare(`SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?`).all('attention')
    expect(hit).toEqual([])
  })

  it('creates chat_messages table with paper index', () => {
    const db = new Database(':memory:')
    migrate(db)
    const info = db.prepare(
      'INSERT INTO chat_messages (paper_key, role, content, reasoning, created_at) VALUES (?,?,?,?,?)'
    ).run('P1', 'user', '这篇论文的核心贡献是什么？', null, 1700000000000)
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid)
    expect(row).toMatchObject({
      paper_key: 'P1', role: 'user', content: '这篇论文的核心贡献是什么？',
      reasoning: null, created_at: 1700000000000,
    })
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index'"
    ).all().map((r: any) => r.name)
    expect(indexes).toContain('idx_chat_paper')
  })
})
