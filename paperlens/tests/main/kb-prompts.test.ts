import { describe, it, expect } from 'vitest'
import { buildQueryExpansionMessages, parseQueryTerms, buildKbAnswerMessages } from '../../src/main/services/kb'

describe('buildQueryExpansionMessages', () => {
  it('asks for a bilingual JSON keyword array', () => {
    const msgs = buildQueryExpansionMessages('哪些论文讨论了人类反馈强化学习？')
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('JSON')
    expect(msgs[0].content).toMatch(/英文|English/)
    expect(msgs[1]).toEqual({ role: 'user', content: '哪些论文讨论了人类反馈强化学习？' })
  })
})

describe('parseQueryTerms', () => {
  it('parses terms from plain or fenced arrays, trims, dedups, caps at 6', () => {
    expect(parseQueryTerms('["RLHF","人类反馈","reinforcement learning"]'))
      .toEqual(['RLHF', '人类反馈', 'reinforcement learning'])
    expect(parseQueryTerms('```json\n["a1","b2","a1","c3","d4","e5","f6","g7"]\n```'))
      .toEqual(['a1', 'b2', 'c3', 'd4', 'e5', 'f6'])
  })
  it('drops non-strings/too-short and returns [] on garbage', () => {
    expect(parseQueryTerms('[1, "x", "对齐", ""]')).toEqual(['对齐'])
    expect(parseQueryTerms('没有数组')).toEqual([])
  })
})

describe('buildKbAnswerMessages', () => {
  it('embeds numbered sources and demands citation + honesty', () => {
    const msgs = buildKbAnswerMessages('RLHF 是什么？', [
      { paperTitle: '论文A', text: '片段一' },
      { paperTitle: '论文B', text: '片段二' },
    ])
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('【来源1 · 论文A】')
    expect(msgs[0].content).toContain('片段二')
    expect(msgs[0].content).toMatch(/\[来源N\]|来源标注/)
    expect(msgs[0].content).toMatch(/不知道|无法回答|没有提及/)
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'RLHF 是什么？' })
  })
})
