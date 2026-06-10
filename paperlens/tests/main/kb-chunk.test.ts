import { describe, it, expect } from 'vitest'
import { chunkText } from '../../src/main/services/kb'

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
