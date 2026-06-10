import { describe, it, expect } from 'vitest'
import { buildRerankMessages, parseRerankScores, type ChunkHit } from '../../src/main/services/kb'

const hit = (id: number, text: string): ChunkHit =>
  ({ id, paperKey: `P${id}`, paperTitle: `论文${id}`, text })

describe('buildRerankMessages', () => {
  it('asks for a 0-3 JSON score array of exactly N numbers', () => {
    const msgs = buildRerankMessages('RLHF 的局限是什么？', [hit(1, '片段甲'), hit(2, '片段乙'), hit(3, '片段丙')])
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('0-3')
    expect(msgs[0].content).toContain('JSON')
    expect(msgs[0].content).toContain('3')
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('RLHF 的局限是什么？')
    expect(msgs[1].content).toContain('1')
    expect(msgs[1].content).toContain('片段甲')
    expect(msgs[1].content).toContain('2')
    expect(msgs[1].content).toContain('片段乙')
    expect(msgs[1].content).toContain('片段丙')
  })

  it('truncates each chunk to 500 chars in the user message', () => {
    const msgs = buildRerankMessages('问题', [hit(1, 'y'.repeat(900))])
    expect(msgs[1].content).toContain('y'.repeat(500))
    expect(msgs[1].content).not.toContain('y'.repeat(501))
  })
})

describe('parseRerankScores', () => {
  it('parses a valid array (also from fenced/noisy text)', () => {
    expect(parseRerankScores('[3, 0, 2]', 3)).toEqual([3, 0, 2])
    expect(parseRerankScores('打分如下：```json\n[1,2,3]\n```', 3)).toEqual([1, 2, 3])
  })

  it('returns null when length does not match count', () => {
    expect(parseRerankScores('[1,2]', 3)).toBeNull()
    expect(parseRerankScores('[1,2,3,0]', 3)).toBeNull()
  })

  it('returns null on garbage, non-array, or non-number entries', () => {
    expect(parseRerankScores('没法打分', 2)).toBeNull()
    expect(parseRerankScores('{"a":1}', 1)).toBeNull()
    expect(parseRerankScores('["高",1]', 2)).toBeNull()
    expect(parseRerankScores('[1,null]', 2)).toBeNull()
  })

  it('clamps out-of-range numbers into 0-3', () => {
    expect(parseRerankScores('[-1, 5, 2.5]', 3)).toEqual([0, 3, 2.5])
  })
})
