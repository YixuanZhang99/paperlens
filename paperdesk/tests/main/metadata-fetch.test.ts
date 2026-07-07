import { describe, it, expect, vi } from 'vitest'
import { parseRefInput, fetchArxivMeta, fetchCrossrefMeta } from '../../src/main/services/metadata-fetch'

describe('parseRefInput', () => {
  it('recognizes arXiv ids and links (with/without version)', () => {
    expect(parseRefInput('2405.12345')).toEqual({ kind: 'arxiv', id: '2405.12345' })
    expect(parseRefInput('2405.12345v2')).toEqual({ kind: 'arxiv', id: '2405.12345v2' })
    expect(parseRefInput('https://arxiv.org/abs/1706.03762')).toEqual({ kind: 'arxiv', id: '1706.03762' })
    expect(parseRefInput('https://arxiv.org/pdf/1706.03762v5')).toEqual({ kind: 'arxiv', id: '1706.03762v5' })
  })
  it('recognizes DOIs and doi links/prefixes', () => {
    expect(parseRefInput('10.1145/3292500.3330919')).toEqual({ kind: 'doi', doi: '10.1145/3292500.3330919' })
    expect(parseRefInput('https://doi.org/10.1038/s41586-021-03819-2')).toEqual({ kind: 'doi', doi: '10.1038/s41586-021-03819-2' })
    expect(parseRefInput('doi:10.18653/v1/2020.acl-main.1')).toEqual({ kind: 'doi', doi: '10.18653/v1/2020.acl-main.1' })
  })
  it('returns unknown for garbage', () => {
    expect(parseRefInput('随便写点什么').kind).toBe('unknown')
    expect(parseRefInput('').kind).toBe('unknown')
  })
})

const ARXIV_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All
 You Need</title>
    <summary>  The dominant sequence transduction models are based on RNNs.
</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
  </entry>
</feed>`

describe('fetchArxivMeta', () => {
  it('parses title (folded lines), authors, year, summary and pdfUrl', async () => {
    const f = vi.fn(async () => new Response(ARXIV_ATOM, { status: 200 }))
    const m = await fetchArxivMeta('1706.03762', f as unknown as typeof fetch)
    expect(m.title).toBe('Attention Is All You Need')
    expect(m.authors).toEqual(['Ashish Vaswani', 'Noam Shazeer'])
    expect(m.year).toBe(2017)
    expect(m.abstract).toContain('dominant sequence transduction')
    expect(m.arxivId).toBe('1706.03762')
    expect(m.pdfUrl).toBe('https://arxiv.org/pdf/1706.03762')
  })
  it('throws when the entry is missing (bad id)', async () => {
    const f = vi.fn(async () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', { status: 200 }))
    await expect(fetchArxivMeta('9999.99999', f as unknown as typeof fetch)).rejects.toThrow(/未找到/)
  })
  it('throws on non-200', async () => {
    const f = vi.fn(async () => new Response('err', { status: 503 }))
    await expect(fetchArxivMeta('1706.03762', f as unknown as typeof fetch)).rejects.toThrow(/503/)
  })
})

const CROSSREF_JSON = JSON.stringify({
  message: {
    title: ['BERT: Pre-training of Deep Bidirectional Transformers'],
    author: [{ given: 'Jacob', family: 'Devlin' }, { family: 'Chang' }],
    published: { 'date-parts': [[2019, 6]] },
    abstract: '<jats:p>We introduce <jats:italic>BERT</jats:italic>.</jats:p>',
  },
})

describe('fetchCrossrefMeta', () => {
  it('parses title/authors/year and strips JATS tags from abstract', async () => {
    const f = vi.fn(async () => new Response(CROSSREF_JSON, { status: 200 }))
    const m = await fetchCrossrefMeta('10.18653/v1/n19-1423', f as unknown as typeof fetch)
    expect(m.title).toBe('BERT: Pre-training of Deep Bidirectional Transformers')
    expect(m.authors).toEqual(['Jacob Devlin', 'Chang'])
    expect(m.year).toBe(2019)
    expect(m.abstract).toBe('We introduce BERT.')
    expect(m.doi).toBe('10.18653/v1/n19-1423')
    expect(m.pdfUrl).toBeNull()
  })
  it('tolerates missing author/year/abstract', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: { title: ['X'] } }), { status: 200 }))
    const m = await fetchCrossrefMeta('10.1/x', f as unknown as typeof fetch)
    expect(m).toMatchObject({ title: 'X', authors: [], year: null, abstract: '' })
  })
  it('throws on 404 (bad doi)', async () => {
    const f = vi.fn(async () => new Response('Not found', { status: 404 }))
    await expect(fetchCrossrefMeta('10.9/nope', f as unknown as typeof fetch)).rejects.toThrow(/404/)
  })
})
