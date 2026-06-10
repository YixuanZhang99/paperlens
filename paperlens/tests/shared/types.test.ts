import { describe, it, expect } from 'vitest'
import { PaperSchema, NoteSchema, AppConfigSchema, ChatMessageSchema } from '@shared/types'

describe('shared schemas', () => {
  it('parses a valid paper', () => {
    const p = PaperSchema.parse({
      key: 'ABC123',
      title: 'Attention Is All You Need',
      authors: ['Vaswani'],
      year: 2017,
      abstract: 'We propose...',
      attachmentKey: 'PDFKEY',
    })
    expect(p.title).toContain('Attention')
  })

  it('rejects a paper without a key', () => {
    expect(() => PaperSchema.parse({ title: 'x' })).toThrow()
  })

  it('parses a note with required fields', () => {
    const n = NoteSchema.parse({
      id: 'n1', paperKey: 'ABC123', content: '核心贡献是自注意力',
      tags: ['transformer'], createdAt: 1700000000000,
    })
    expect(n.tags).toEqual(['transformer'])
  })

  it('validates app config with empty defaults', () => {
    const c = AppConfigSchema.parse({})
    expect(c.zoteroUserId).toBe('')
    expect(c.deepseekModel).toBe('deepseek-v4-flash')
  })

  it('defaults zoteroDataDir to empty string', () => {
    const c = AppConfigSchema.parse({})
    expect(c.zoteroDataDir).toBe('')
  })

  it('parses a valid chat message', () => {
    const m = ChatMessageSchema.parse({ role: 'user', content: 'hi' })
    expect(m.role).toBe('user')
  })

  it('rejects a chat message with an invalid role', () => {
    expect(() => ChatMessageSchema.parse({ role: 'bad', content: 'x' })).toThrow()
  })
})
