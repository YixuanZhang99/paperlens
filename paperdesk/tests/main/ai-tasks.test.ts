import { describe, it, expect } from 'vitest'
import { buildDeepReadMessages, buildTagMessages, parseTags } from '../../src/main/services/ai-chat'
import type { Paper } from '@shared/types'

const paper: Paper = {
  key: 'P1', title: 'Transformer', authors: ['Vaswani'], year: 2017,
  abstract: 'attention', attachmentKey: null,
}

describe('buildDeepReadMessages', () => {
  it('builds system prompt with metadata, five sections, and the paper text', () => {
    const msgs = buildDeepReadMessages(paper, '正文ABC')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    for (const s of ['背景问题', '核心贡献', '方法', '实验与结论', '局限与展望']) {
      expect(msgs[0].content).toContain(s)
    }
    expect(msgs[0].content).toContain('Transformer')
    expect(msgs[0].content).toContain('正文ABC')
    expect(msgs[1].role).toBe('user')
  })

  it('truncates paper text to maxContextChars', () => {
    const msgs = buildDeepReadMessages(paper, 'X'.repeat(1000), 100)
    expect(msgs[0].content).toContain('X'.repeat(100))
    expect(msgs[0].content).not.toContain('X'.repeat(101))
  })
})

describe('buildTagMessages', () => {
  it('asks for a JSON array and truncates long content', () => {
    const msgs = buildTagMessages('内容'.repeat(5000))
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('JSON')
    expect(msgs[1].content.length).toBeLessThanOrEqual(4000)
  })
})

describe('parseTags', () => {
  it('parses a plain JSON array', () => {
    expect(parseTags('["transformer","注意力机制"]')).toEqual(['transformer', '注意力机制'])
  })
  it('parses an array inside a markdown fence with surrounding prose', () => {
    expect(parseTags('好的，标签如下：\n```json\n["nlp","LLM"]\n```')).toEqual(['nlp', 'LLM'])
  })
  it('returns [] for garbage / no array / bad json', () => {
    expect(parseTags('没有数组')).toEqual([])
    expect(parseTags('[1, 2, }')).toEqual([])
  })
  it('filters non-strings/blanks and caps at 4', () => {
    expect(parseTags('[1, "a", "", "b", "c", "d", "e"]')).toEqual(['a', 'b', 'c', 'd'])
  })
})
