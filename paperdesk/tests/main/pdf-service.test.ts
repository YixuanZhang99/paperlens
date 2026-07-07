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

function fakeDoc(pages: string[]) {
  return {
    numPages: pages.length,
    async getPage(n: number) { return { async getTextContent() { return { items: pages[n - 1].split(' ').map(str => ({ str })) } } } },
  }
}

describe('extractPdfText pageMarkers', () => {
  it('injects [第N页] before each page when pageMarkers=true', async () => {
    const t = await extractPdfText(new Uint8Array(), { loadDocument: async () => fakeDoc(['alpha', 'beta']), pageMarkers: true })
    expect(t).toContain('[第1页]')
    expect(t).toContain('[第2页]')
    expect(t.indexOf('[第1页]')).toBeLessThan(t.indexOf('alpha'))
    expect(t.indexOf('alpha')).toBeLessThan(t.indexOf('[第2页]'))
  })
  it('omits markers by default (KB/deepread unchanged)', async () => {
    const t = await extractPdfText(new Uint8Array(), { loadDocument: async () => fakeDoc(['alpha', 'beta']) })
    expect(t).not.toContain('[第1页]')
    expect(t).toContain('alpha')
  })
})

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
