import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import {
  insertChunks,
  representativeChunks,
  buildReviewMapMessages,
  buildReviewReduceMessages,
} from '../../src/main/services/kb'

function seeded() {
  const db = new Database(':memory:')
  migrate(db)
  insertChunks(db, 'P1', 'RLHF 论文', ['段0 摘要', '段1 引言', '段2 方法', '段3 实验', '段4 结论'])
  insertChunks(db, 'P2', '蒸馏论文', ['蒸馏段0', '蒸馏段1'])
  return db
}

describe('representativeChunks', () => {
  it('returns first k chunks ordered by seq', () => {
    const db = seeded()
    expect(representativeChunks(db, 'P1', 3)).toEqual(['段0 摘要', '段1 引言', '段2 方法'])
  })
  it('returns all chunks when fewer than k', () => {
    const db = seeded()
    expect(representativeChunks(db, 'P2', 3)).toEqual(['蒸馏段0', '蒸馏段1'])
  })
  it('returns [] for paper with no chunks', () => {
    const db = seeded()
    expect(representativeChunks(db, 'NOPE')).toEqual([])
  })
})

describe('buildReviewMapMessages', () => {
  it('system instructs key-point extraction in Markdown', () => {
    const msgs = buildReviewMapMessages('RLHF 论文', ['片段一', '片段二'])
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('要点')
    expect(msgs[0].content).toContain('Markdown')
  })
  it('user contains title and every chunk', () => {
    const msgs = buildReviewMapMessages('RLHF 论文', ['片段一', '片段二'])
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('标题：RLHF 论文')
    expect(msgs[1].content).toContain('片段一')
    expect(msgs[1].content).toContain('片段二')
  })
})

describe('buildReviewReduceMessages', () => {
  const items = [
    { title: 'RLHF 论文', points: '- 用人类反馈训练奖励模型' },
    { title: '蒸馏论文', points: '- 大模型知识迁移到小模型' },
  ]
  it('system requires the four required sections', () => {
    const msgs = buildReviewReduceMessages('全部论文', items)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    for (const sec of ['## 主题分组', '## 方法对照', '## 主要分歧', '## 开放问题']) {
      expect(msgs[0].content).toContain(sec)
    }
  })
  it('user contains scope label, every title and points', () => {
    const msgs = buildReviewReduceMessages('全部论文', items)
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('综述范围：全部论文')
    expect(msgs[1].content).toContain('### RLHF 论文')
    expect(msgs[1].content).toContain('- 用人类反馈训练奖励模型')
    expect(msgs[1].content).toContain('### 蒸馏论文')
    expect(msgs[1].content).toContain('- 大模型知识迁移到小模型')
  })
})
