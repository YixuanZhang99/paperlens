import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { createChatRepo } from '../../src/main/services/chat-repo'

function repo() {
  const db = new Database(':memory:')
  migrate(db)
  let t = 1700000000000
  return createChatRepo(db, () => ++t)
}

describe('ChatRepo', () => {
  it('appends a message and lists it back with correct fields', () => {
    const r = repo()
    const saved = r.append({
      paperKey: 'P1', role: 'assistant', content: '本文提出自注意力机制', reasoning: '先回顾问题',
    })
    expect(saved).toMatchObject({
      paperKey: 'P1', role: 'assistant', content: '本文提出自注意力机制',
      reasoning: '先回顾问题', createdAt: 1700000000001,
    })
    expect(saved.id).toBe(1)
    expect(r.listByPaper('P1')).toEqual([saved])
  })

  it('auto-increments ids across appends', () => {
    const r = repo()
    const a = r.append({ paperKey: 'P1', role: 'user', content: '一' })
    const b = r.append({ paperKey: 'P1', role: 'assistant', content: '二' })
    expect(b.id).toBeGreaterThan(a.id)
  })

  it('isolates papers and lists in chronological order', () => {
    const r = repo()
    r.append({ paperKey: 'P1', role: 'user', content: '先问' })
    r.append({ paperKey: 'P2', role: 'user', content: '别的论文' })
    r.append({ paperKey: 'P1', role: 'assistant', content: '后答' })
    const list = r.listByPaper('P1')
    expect(list).toHaveLength(2)
    expect(list.map(m => m.content)).toEqual(['先问', '后答'])
    expect(list[0].createdAt).toBeLessThan(list[1].createdAt)
    expect(r.listByPaper('P2')).toHaveLength(1)
  })

  it('stores null reasoning when omitted', () => {
    const r = repo()
    r.append({ paperKey: 'P1', role: 'user', content: '没有思考过程' })
    expect(r.listByPaper('P1')[0].reasoning).toBeNull()
  })

  it('clears one paper without touching others', () => {
    const r = repo()
    r.append({ paperKey: 'P1', role: 'user', content: 'a' })
    r.append({ paperKey: 'P1', role: 'assistant', content: 'b' })
    r.append({ paperKey: 'P2', role: 'user', content: 'c' })
    r.clearByPaper('P1')
    expect(r.listByPaper('P1')).toEqual([])
    expect(r.listByPaper('P2')).toHaveLength(1)
  })
})
