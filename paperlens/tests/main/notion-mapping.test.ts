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
})
