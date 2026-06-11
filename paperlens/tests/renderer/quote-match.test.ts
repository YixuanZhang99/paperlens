import { describe, it, expect } from 'vitest'
import { findQuoteRange, findAllMatchRanges } from '../../src/renderer/lib/quote-match'

describe('findQuoteRange', () => {
  it('hits a single span exactly', () => {
    const spans = ['注意力机制', '是核心', '贡献之一']
    const result = findQuoteRange(spans, '注意力机制')
    expect(result).toEqual({ start: 0, end: 0 })
  })

  it('spans across two adjacent spans', () => {
    const spans = ['自注意力', '机制提出']
    // quote crosses the boundary between span 0 and span 1
    const result = findQuoteRange(spans, '自注意力机制')
    expect(result).toEqual({ start: 0, end: 1 })
  })

  it('matches despite extra whitespace and case differences', () => {
    const spans = ['Transformer  Architecture\n', 'is  great']
    // Normalised spans: 'transformerarchitecture' + 'isgreat'
    const result = findQuoteRange(spans, 'Transformer Architecture')
    expect(result).toEqual({ start: 0, end: 0 })
  })

  it('returns null when quote is not found', () => {
    const spans = ['自注意力机制', '是核心贡献']
    expect(findQuoteRange(spans, '循环神经网络')).toBeNull()
  })

  it('returns null when normalised quote is shorter than 4 chars', () => {
    const spans = ['abc', 'def']
    expect(findQuoteRange(spans, 'ab')).toBeNull()    // 2 chars
    expect(findQuoteRange(spans, 'abc')).toBeNull()   // 3 chars
    expect(findQuoteRange(spans, ' a  ')).toBeNull()  // normalises to 1 char
  })
})

describe('findAllMatchRanges (PDF 页内搜索)', () => {
  it('finds a match that crosses a span boundary (the core search bug)', () => {
    // pdf.js 常把一个词拆成相邻两个 span：'...vey' + 'Kai...'
    const spans = ['Some sur', 'vey', 'Kai et al']
    // 搜 'veyKai'（跨 span 1↔2），旧的逐 span includes 会得 0
    expect(findAllMatchRanges(spans, 'veyKai')).toEqual([{ start: 1, end: 2 }])
  })

  it('finds a phrase with a space spanning two spans', () => {
    const spans = ['language', 'model is']
    // 'language model' 归一化为 'languagemodel'，跨 span 0↔1
    expect(findAllMatchRanges(spans, 'language model')).toEqual([{ start: 0, end: 1 }])
  })

  it('finds every occurrence, not just the first', () => {
    const spans = ['the cat the dog the end']
    // 'thecatthedogtheend' → 'the' 出现 3 次，全在 span 0
    const ranges = findAllMatchRanges(spans, 'the')
    expect(ranges).toEqual([
      { start: 0, end: 0 },
      { start: 0, end: 0 },
      { start: 0, end: 0 },
    ])
  })

  it('finds repeated cross-span matches across the doc', () => {
    const spans = ['fooBA', 'R baz', 'fooBA', 'R end']
    // 'foobar' 出现 2 次：span0↔1 与 span2↔3
    expect(findAllMatchRanges(spans, 'foo bar')).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ])
  })

  it('is case-insensitive', () => {
    expect(findAllMatchRanges(['Transformer'], 'TRANSFORMER')).toEqual([{ start: 0, end: 0 }])
  })

  it('returns [] for no match', () => {
    expect(findAllMatchRanges(['abc', 'def'], 'xyz')).toEqual([])
  })

  it('returns [] when the normalised query is shorter than 2 chars', () => {
    expect(findAllMatchRanges(['abc'], 'a')).toEqual([])
    expect(findAllMatchRanges(['abc'], ' a ')).toEqual([])
  })
})
