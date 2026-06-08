import { describe, it, expect } from 'vitest'
import { buildMessages } from '../../src/main/services/ai-chat'
import type { Paper } from '@shared/types'

const paper: Paper = {
  key: 'P1', title: 'Transformer', authors: ['Vaswani'], year: 2017,
  abstract: 'attention', attachmentKey: null,
}

describe('buildMessages', () => {
  it('puts a system prompt with paper metadata + truncated full text first', () => {
    const msgs = buildMessages({
      paper, paperText: 'X'.repeat(1000), history: [], userInput: '这篇论文讲了什么？',
      maxContextChars: 100,
    })
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('Transformer')
    expect(msgs[0].content).toContain('Vaswani')
    // 全文被截断到 maxContextChars
    expect(msgs[0].content).toContain('X'.repeat(100))
    expect(msgs[0].content).not.toContain('X'.repeat(101))
    expect(msgs.at(-1)).toEqual({ role: 'user', content: '这篇论文讲了什么？' })
  })

  it('keeps prior conversation history between system and new input', () => {
    const msgs = buildMessages({
      paper, paperText: 'abc',
      history: [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '第一答' }],
      userInput: '第二问', maxContextChars: 1000,
    })
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })
})
