import { describe, it, expect } from 'vitest'
import { findQuoteRange } from '../../src/renderer/lib/quote-match'

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
