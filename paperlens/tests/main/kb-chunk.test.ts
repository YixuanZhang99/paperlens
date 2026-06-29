import { describe, it, expect } from 'vitest'
import { chunkText, chunkPagedText } from '../../src/main/services/kb'

describe('chunkText', () => {
  it('splits long text into overlapping chunks of the given size', () => {
    const text = 'A'.repeat(3000)
    const chunks = chunkText(text, 1200, 150)
    expect(chunks.length).toBe(3) // 步长 1050：0-1200, 1050-2250, 2100-3000
    expect(chunks[0]).toHaveLength(1200)
    expect(chunks[1].slice(0, 150)).toBe(chunks[0].slice(-150))
    expect(chunks.at(-1)!.length).toBeLessThanOrEqual(1200)
  })

  it('returns single chunk for short text and [] for blank', () => {
    expect(chunkText('短文本', 1200, 150)).toEqual(['短文本'])
    expect(chunkText('   ', 1200, 150)).toEqual([])
  })

  it('uses defaults size=1200 overlap=150', () => {
    expect(chunkText('B'.repeat(1250))[0]).toHaveLength(1200)
  })
})

describe('chunkPagedText', () => {
  it('splits by [第N页] markers and tags each chunk with its source page', () => {
    const paged = '[第1页]\n第一页内容\n[第2页]\n第二页内容\n[第3页]\n第三页内容'
    const out = chunkPagedText(paged)
    expect(out).toEqual([
      { text: '第一页内容', page: 1 },
      { text: '第二页内容', page: 2 },
      { text: '第三页内容', page: 3 },
    ])
  })

  it('chunks long page bodies without crossing page boundaries', () => {
    const paged = `[第5页]\n${'A'.repeat(3000)}\n[第6页]\n${'B'.repeat(50)}`
    const out = chunkPagedText(paged, 1200, 150)
    // 第5页 3000 字切成 3 块（均 page=5），第6页 1 块（page=6）
    expect(out.filter(c => c.page === 5).length).toBe(3)
    expect(out.filter(c => c.page === 6).length).toBe(1)
    expect(out.every(c => /^A+$/.test(c.text) ? c.page === 5 : true)).toBe(true)
  })

  it('falls back to page 0 when there are no page markers', () => {
    expect(chunkPagedText('没有页标记的纯文本')).toEqual([{ text: '没有页标记的纯文本', page: 0 }])
  })
})
