import { describe, it, expect } from 'vitest'
import { noteToNotionPage } from '../../src/main/services/notion-sync'
import type { Note, Paper } from '@shared/types'

const paper: Paper = {
  key: 'P1', title: 'Transformer', authors: ['Vaswani', 'Shazeer'], year: 2017,
  abstract: 'a', attachmentKey: null,
}
const note: Note = {
  id: 'n1', paperKey: 'P1', content: '核心是自注意力机制', tags: ['nlp', 'attention'],
  createdAt: 1700000000000, notionPageId: null,
}

describe('noteToNotionPage', () => {
  it('maps paper + note into a database page with typed properties', () => {
    const page = noteToNotionPage(note, paper, 'db-123')
    expect(page.parent).toEqual({ database_id: 'db-123' })
    expect(page.properties.Title.title[0].text.content).toBe('Transformer')
    expect(page.properties.Authors.rich_text[0].text.content).toBe('Vaswani, Shazeer')
    expect(page.properties.Year.number).toBe(2017)
    expect(page.properties.Tags.multi_select.map((t: any) => t.name)).toEqual(['nlp', 'attention'])
    // 笔记正文进入页面 body（children paragraph）
    expect(page.children[0].paragraph.rich_text[0].text.content).toBe('核心是自注意力机制')
  })

  it('omits Year when paper.year is null', () => {
    const page = noteToNotionPage(note, { ...paper, year: null }, 'db-123')
    expect(page.properties.Year).toBeUndefined()
  })

  it('splits long content into ≤2000-char paragraph blocks (Notion rich_text limit)', () => {
    const longNote = { ...note, content: 'A'.repeat(4500) }
    const page = noteToNotionPage(longNote, paper, 'db-123')
    expect(page.children).toHaveLength(3)
    for (const block of page.children) {
      expect(block.type).toBe('paragraph')
      expect(block.paragraph.rich_text[0].text.content.length).toBeLessThanOrEqual(2000)
    }
    const joined = page.children.map((b) => b.paragraph.rich_text[0].text.content).join('')
    expect(joined).toBe(longNote.content)
  })

  it('clamps over-long Authors to ≤2000 chars (the reported 400)', () => {
    const many = { ...paper, authors: Array.from({ length: 200 }, (_, i) => `Author Number ${i} Longname`) }
    const page = noteToNotionPage(note, many, 'db-123')
    expect(page.properties.Authors.rich_text[0].text.content.length).toBeLessThanOrEqual(2000)
  })

  it('clamps over-long Title to ≤2000 chars', () => {
    const page = noteToNotionPage(note, { ...paper, title: 'T'.repeat(2500) }, 'db-123')
    expect(page.properties.Title.title[0].text.content.length).toBe(2000)
  })

  it('sanitizes tags: strips commas, caps at 100 chars, drops empties', () => {
    const t = { ...note, tags: ['机器学习,深度学习', 'x'.repeat(150), '   ', 'ok'] }
    const page = noteToNotionPage(t, paper, 'db-123')
    const names = page.properties.Tags.multi_select.map((o: any) => o.name)
    expect(names).not.toContain('') // 空标签被过滤
    expect(names.some((n: string) => n.includes(','))).toBe(false) // 无逗号
    expect(names.every((n: string) => n.length <= 100)).toBe(true) // ≤100
    expect(names).toContain('ok')
    expect(names).toContain('机器学习 深度学习') // 逗号→空格
  })

  it('omits Year when not a finite integer (NaN/Infinity/float)', () => {
    for (const bad of [NaN, Infinity, -Infinity, 2017.5]) {
      const page = noteToNotionPage(note, { ...paper, year: bad as number }, 'db-123')
      expect(page.properties.Year).toBeUndefined()
    }
    expect(noteToNotionPage(note, { ...paper, year: 2017 }, 'db-123').properties.Year.number).toBe(2017)
  })

  it('caps children blocks at 100 for very long notes (Notion block limit)', () => {
    const huge = { ...note, content: 'A'.repeat(2000 * 150) } // 150 块原始
    const page = noteToNotionPage(huge, paper, 'db-123')
    expect(page.children.length).toBeLessThanOrEqual(100)
    expect(page.children.at(-1)!.paragraph.rich_text[0].text.content).toContain('已截断')
  })
})
