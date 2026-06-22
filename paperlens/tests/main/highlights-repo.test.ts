import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { createHighlightsRepo } from '../../src/main/services/highlights-repo'

function repo() {
  const db = new Database(':memory:')
  migrate(db)
  let seq = 0
  return createHighlightsRepo({ db, now: () => 1700000000000, genId: () => `h-${++seq}` })
}

const sample = (over: Partial<Parameters<ReturnType<typeof repo>['add']>[0]> = {}) => ({
  paperKey: 'P1',
  pageIndex: 0,
  rects: [[10, 20, 100, 32]],
  text: 'self-attention',
  color: '#ffd400',
  ...over,
})

describe('HighlightsRepo', () => {
  it('saves a highlight and round-trips rects as JSON', () => {
    const r = repo()
    const hl = r.add(sample({ rects: [[1, 2, 3, 4], [5, 6, 7, 8]] }))
    expect(hl.id).toBe('h-1')
    expect(hl.zoteroKey).toBeNull()
    expect(hl.comment).toBeNull()
    const [reloaded] = r.listByPaper('P1')
    expect(reloaded.rects).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]])
    expect(reloaded.text).toBe('self-attention')
    expect(reloaded.createdAt).toBe(1700000000000)
  })

  it('lists by paper ordered by page then creation, scoped to the paper', () => {
    const r = repo()
    r.add(sample({ pageIndex: 2, text: 'c' }))
    r.add(sample({ pageIndex: 0, text: 'a' }))
    r.add(sample({ pageIndex: 0, text: 'b' }))
    r.add(sample({ paperKey: 'P2', text: 'other' }))
    const list = r.listByPaper('P1')
    expect(list.map(h => h.text)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a comment when provided', () => {
    const r = repo()
    r.add(sample({ comment: '关键定义' }))
    expect(r.listByPaper('P1')[0].comment).toBe('关键定义')
  })

  it('updates comment and color independently', () => {
    const r = repo()
    const hl = r.add(sample())
    r.update(hl.id, { comment: '改后的注释' })
    expect(r.get(hl.id)?.comment).toBe('改后的注释')
    expect(r.get(hl.id)?.color).toBe('#ffd400') // 未传 color，保持不变
    r.update(hl.id, { color: '#ff6666' })
    expect(r.get(hl.id)?.color).toBe('#ff6666')
    expect(r.get(hl.id)?.comment).toBe('改后的注释') // 未传 comment，保持不变
    r.update(hl.id, { comment: null }) // 显式清空
    expect(r.get(hl.id)?.comment).toBeNull()
  })

  it('marks synced and excludes synced from listUnsynced', () => {
    const r = repo()
    const a = r.add(sample({ text: 'a' }))
    const b = r.add(sample({ text: 'b' }))
    expect(r.listUnsynced('P1').map(h => h.text)).toEqual(['a', 'b'])
    r.markSynced(a.id, 'ZOTKEY1')
    expect(r.get(a.id)?.zoteroKey).toBe('ZOTKEY1')
    expect(r.listUnsynced('P1').map(h => h.text)).toEqual(['b'])
  })

  it('removes by id and ignores unknown ids', () => {
    const r = repo()
    const a = r.add(sample())
    r.remove(a.id)
    expect(r.listByPaper('P1')).toHaveLength(0)
    expect(() => r.remove('nope')).not.toThrow()
  })

  it('get returns null for unknown id', () => {
    expect(repo().get('missing')).toBeNull()
  })
})
