import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { insertChunks, searchChunks, kbStatus, indexedPaperKeys } from '../../src/main/services/kb'

function seeded() {
  const db = new Database(':memory:')
  migrate(db)
  insertChunks(db, 'P1', 'RLHF 论文', ['reward model 与 RLHF 对齐训练', '第二段讲 PPO 算法细节'])
  insertChunks(db, 'P2', '蒸馏论文', ['knowledge distillation 知识蒸馏方法'])
  return db
}

describe('insertChunks / indexedPaperKeys / kbStatus', () => {
  it('stores chunks with seq and reports status', () => {
    const db = seeded()
    expect(indexedPaperKeys(db)).toEqual(new Set(['P1', 'P2']))
    expect(kbStatus(db)).toEqual({ indexedPapers: 2, totalChunks: 3 })
  })
  it('re-inserting a paper replaces its old chunks', () => {
    const db = seeded()
    insertChunks(db, 'P1', 'RLHF 论文', ['新版本片段'])
    expect(kbStatus(db).totalChunks).toBe(2)
    expect(searchChunks(db, ['PPO'])).toHaveLength(0)
  })
})

describe('searchChunks', () => {
  it('MATCH finds long terms and returns paper info', () => {
    const hits = searchChunks(seeded(), ['RLHF'])
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0]).toMatchObject({ paperKey: 'P1', paperTitle: 'RLHF 论文' })
    expect(hits[0].text).toContain('RLHF')
  })
  it('2-char CJK terms fall back to LIKE', () => {
    const hits = searchChunks(seeded(), ['蒸馏'])
    expect(hits).toHaveLength(1)
    expect(hits[0].paperKey).toBe('P2')
  })
  it('multi-term hits merge & rank by term coverage, capped at k', () => {
    const hits = searchChunks(seeded(), ['RLHF', 'PPO', '蒸馏'], 2)
    expect(hits).toHaveLength(2)
    expect(hits.some(h => h.paperKey === 'P1')).toBe(true)
  })
})
