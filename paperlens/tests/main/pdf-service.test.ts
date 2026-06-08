import { describe, it, expect, vi } from 'vitest'
import { extractPdfText } from '../../src/main/services/pdf-service'

// 伪造 pdfjs：2 页，每页若干 text item
function fakeLoader() {
  const page = (strs: string[]) => ({
    getTextContent: async () => ({ items: strs.map(s => ({ str: s })) }),
  })
  return vi.fn(async (_data: Uint8Array) => ({
    numPages: 2,
    getPage: async (n: number) =>
      n === 1 ? page(['Hello', 'world']) : page(['second', 'page']),
  }))
}

describe('extractPdfText', () => {
  it('joins text items across pages with spaces and newlines', async () => {
    const text = await extractPdfText(new Uint8Array([1, 2, 3]), { loadDocument: fakeLoader() })
    expect(text).toBe('Hello world\nsecond page')
  })

  it('caps output at maxChars', async () => {
    const text = await extractPdfText(new Uint8Array([1]), {
      loadDocument: fakeLoader(), maxChars: 5,
    })
    expect(text.length).toBeLessThanOrEqual(5)
  })
})
