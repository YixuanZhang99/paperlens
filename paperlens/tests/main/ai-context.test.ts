import { describe, it, expect } from 'vitest'
import { buildMessages } from '../../src/main/services/ai-chat'
import type { Paper } from '@shared/types'

const paper: Paper = {
  key: 'P1', title: 'Transformer', authors: ['Vaswani'], year: 2017,
  abstract: 'attention', attachmentKey: null,
}

describe('buildMessages', () => {
  it('puts a system prompt with paper metadata + truncated full text first', () => {
    const { messages: msgs } = buildMessages({
      paper, paperText: 'X'.repeat(1000), history: [], userInput: '这篇论文讲了什么？',
      maxContextChars: 100,
    })
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('Transformer')
    expect(msgs[0].content).toContain('Vaswani')
    // 截断为头 70 + 尾 30，中间以省略标记相连
    expect(msgs[0].content).toContain('X'.repeat(70) + '\n\n…（中间略）…\n\n' + 'X'.repeat(30))
    expect(msgs[0].content).not.toContain('X'.repeat(71))
    expect(msgs.at(-1)).toEqual({ role: 'user', content: '这篇论文讲了什么？' })
  })

  it('keeps prior conversation history between system and new input', () => {
    const { messages: msgs } = buildMessages({
      paper, paperText: 'abc',
      history: [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '第一答' }],
      userInput: '第二问', maxContextChars: 1000,
    })
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })

  it('caps history to the most recent maxHistoryMessages', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }))
    const { messages: msgs } = buildMessages({ paper, paperText: 'x', history, userInput: '新问题', maxHistoryMessages: 4 })
    // system + last 4 history + new user = 6
    expect(msgs).toHaveLength(6)
    expect(msgs[0].role).toBe('system')
    expect(msgs.slice(1, 5).map(m => m.content)).toEqual(['m26', 'm27', 'm28', 'm29'])
    expect(msgs.at(-1)).toEqual({ role: 'user', content: '新问题' })
  })

  it('keeps all history when under the default cap', () => {
    const history = [
      { role: 'user' as const, content: 'a' },
      { role: 'assistant' as const, content: 'b' },
    ]
    const { messages: msgs } = buildMessages({ paper, paperText: 'x', history, userInput: 'q' })
    expect(msgs.map(m => m.content)).toEqual([msgs[0].content, 'a', 'b', 'q'])
    expect(msgs).toHaveLength(4)
  })
})
