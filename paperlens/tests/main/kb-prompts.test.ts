import { describe, it, expect } from 'vitest'
import {
  buildQueryExpansionMessages,
  parseQueryTerms,
  buildKbAnswerMessages,
  buildKbFollowupMessages,
  groupHitsToSources,
  type ChunkHit,
  type KbSource,
} from '../../src/main/services/kb'
import type { ChatMessage } from '@shared/types'

describe('buildQueryExpansionMessages', () => {
  it('asks for a bilingual JSON keyword array', () => {
    const msgs = buildQueryExpansionMessages('哪些论文讨论了人类反馈强化学习？')
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('JSON')
    expect(msgs[0].content).toMatch(/英文|English/)
    expect(msgs[1]).toEqual({ role: 'user', content: '哪些论文讨论了人类反馈强化学习？' })
  })

  it('with history: system embeds a transcript excerpt and asks to resolve references', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'RLHF 是什么？' },
      { role: 'assistant', content: 'RLHF 是基于人类反馈的强化学习……' },
    ]
    const msgs = buildQueryExpansionMessages('它有哪些局限？', history)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('RLHF 是什么？')
    expect(msgs[0].content).toContain('RLHF 是基于人类反馈的强化学习')
    expect(msgs[0].content).toContain('指代')
    expect(msgs[1]).toEqual({ role: 'user', content: '它有哪些局限？' })
  })

  it('with history: keeps at most the last 2 rounds and truncates each entry to 200 chars', () => {
    const long = 'x'.repeat(500)
    const history: ChatMessage[] = [
      { role: 'user', content: '第一轮问题（应被丢弃）' },
      { role: 'assistant', content: '第一轮回答（应被丢弃）' },
      { role: 'user', content: '第二轮问题' },
      { role: 'assistant', content: long },
      { role: 'user', content: '第三轮问题' },
      { role: 'assistant', content: '第三轮回答' },
    ]
    const msgs = buildQueryExpansionMessages('继续', history)
    const sys = msgs[0].content
    expect(sys).not.toContain('第一轮问题')
    expect(sys).toContain('第二轮问题')
    expect(sys).toContain('第三轮回答')
    expect(sys).toContain('x'.repeat(200))
    expect(sys).not.toContain('x'.repeat(201))
  })

  it('without history: behaves exactly as before (no transcript section)', () => {
    const msgs = buildQueryExpansionMessages('问题')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).not.toContain('指代')
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

const hit = (id: number, paperKey: string, paperTitle: string, text: string): ChunkHit =>
  ({ id, paperKey, paperTitle, text })

describe('groupHitsToSources', () => {
  it('groups hits by paperKey preserving first-hit order', () => {
    const sources = groupHitsToSources([
      hit(1, 'P1', '论文A', '片段一'),
      hit(2, 'P2', '论文B', '片段二'),
      hit(3, 'P1', '论文A', '片段三'),
    ])
    expect(sources).toHaveLength(2)
    expect(sources[0]).toEqual({ paperKey: 'P1', paperTitle: '论文A', chunks: ['片段一', '片段三'] })
    expect(sources[1]).toEqual({ paperKey: 'P2', paperTitle: '论文B', chunks: ['片段二'] })
  })

  it('caps chunks at 3 per paper, dropping the rest', () => {
    const sources = groupHitsToSources([
      hit(1, 'P1', '论文A', 'c1'),
      hit(2, 'P1', '论文A', 'c2'),
      hit(3, 'P1', '论文A', 'c3'),
      hit(4, 'P1', '论文A', 'c4'),
    ])
    expect(sources).toHaveLength(1)
    expect(sources[0].chunks).toEqual(['c1', 'c2', 'c3'])
  })

  it('returns [] for no hits', () => {
    expect(groupHitsToSources([])).toEqual([])
  })
})

describe('buildKbAnswerMessages', () => {
  const src = (paperKey: string, paperTitle: string, chunks: string[]): KbSource =>
    ({ paperKey, paperTitle, chunks })

  it('embeds paper-numbered sources and demands citation + honesty', () => {
    const msgs = buildKbAnswerMessages('RLHF 是什么？', [
      src('P1', '论文A', ['片段一']),
      src('P2', '论文B', ['片段二']),
    ])
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('【来源1 · 论文A】')
    expect(msgs[0].content).toContain('【来源2 · 论文B】')
    expect(msgs[0].content).toContain('片段二')
    expect(msgs[0].content).toMatch(/\[来源N\]|来源标注/)
    expect(msgs[0].content).toContain('来源共 2 个')
    expect(msgs[0].content).toMatch(/不知道|无法回答|没有提及/)
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'RLHF 是什么？' })
  })

  it('joins multiple chunks of one paper with --- under a single source number', () => {
    const msgs = buildKbAnswerMessages('问题', [src('P1', '论文A', ['第一段', '第二段'])])
    const sys = msgs[0].content
    expect(sys).toContain('【来源1 · 论文A】\n第一段\n---\n第二段')
    expect(sys).not.toContain('来源2')
  })

  it('inserts history between system and the current question', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '上一个问题' },
      { role: 'assistant', content: '上一个回答' },
    ]
    const msgs = buildKbAnswerMessages('新问题', [src('P1', '论文A', ['片段'])], history)
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(msgs[1]).toEqual({ role: 'user', content: '上一个问题' })
    expect(msgs[2]).toEqual({ role: 'assistant', content: '上一个回答' })
    expect(msgs[3]).toEqual({ role: 'user', content: '新问题' })
  })
})

describe('buildKbFollowupMessages', () => {
  it('asks for a 3-item JSON array of cross-paper followups and passes the answer as user content', () => {
    const msgs = buildKbFollowupMessages('这是上一轮的全库回答')
    expect(msgs.map(m => m.role)).toEqual(['system', 'user'])
    expect(msgs[0].content).toContain('3 个')
    expect(msgs[0].content).toMatch(/JSON 字符串数组/)
    expect(msgs[1]).toEqual({ role: 'user', content: '这是上一轮的全库回答' })
  })

  it('truncates an overlong answer to 2000 chars', () => {
    const msgs = buildKbFollowupMessages('x'.repeat(5000))
    expect(msgs[1].content.length).toBe(2000)
  })
})
