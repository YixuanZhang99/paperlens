import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { insertChunks, searchChunks, kbStatus, indexedPaperKeys, searchVector, chunksMissingEmbedding, setChunkEmbeddings, embeddingStats } from '../../src/main/services/kb'

function seeded() {
  const db = new Database(':memory:')
  migrate(db)
  insertChunks(db, 'P1', 'RLHF 论文', [{ text: 'reward model 与 RLHF 对齐训练', page: 1 }, { text: '第二段讲 PPO 算法细节', page: 3 }])
  insertChunks(db, 'P2', '蒸馏论文', [{ text: 'knowledge distillation 知识蒸馏方法', page: 1 }])
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
    insertChunks(db, 'P1', 'RLHF 论文', [{ text: '新版本片段', page: 1 }])
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
    expect(hits[0].pageIndex).toBe(1) // 页码随检索返回，支撑来源跳转
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

describe('semantic vector search', () => {
  const vecFor = (text: string): Float32Array =>
    text.includes('RLHF') ? new Float32Array([1, 0, 0, 0])
    : text.includes('PPO') ? new Float32Array([0.8, 0.6, 0, 0])
    : new Float32Array([0, 0, 1, 0])

  it('backfills missing embeddings and reports stats', () => {
    const db = seeded()
    expect(embeddingStats(db)).toEqual({ embedded: 0, total: 3 })
    const missing = chunksMissingEmbedding(db)
    expect(missing.length).toBe(3)
    setChunkEmbeddings(db, missing.map(m => ({ id: m.id, vec: vecFor(m.text) })))
    expect(embeddingStats(db)).toEqual({ embedded: 3, total: 3 })
    expect(chunksMissingEmbedding(db)).toEqual([])
  })

  it('searchVector ranks by cosine and carries pageIndex', () => {
    const db = seeded()
    const missing = chunksMissingEmbedding(db)
    setChunkEmbeddings(db, missing.map(m => ({ id: m.id, vec: vecFor(m.text) })))
    const hits = searchVector(db, new Float32Array([1, 0, 0, 0]), 2)
    expect(hits.length).toBe(2)
    expect(hits[0].text).toContain('RLHF')   // 与查询向量完全一致
    expect(hits[0].pageIndex).toBe(1)        // 来源页码随检索带出
  })

  it('searchVector returns [] when nothing is embedded yet', () => {
    expect(searchVector(seeded(), new Float32Array([1, 0, 0, 0]), 5)).toEqual([])
  })
})
