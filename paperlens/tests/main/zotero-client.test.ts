import { describe, it, expect, vi } from 'vitest'
import { createZoteroClient } from '../../src/main/services/zotero-client'

const sampleItem = (key: string, title: string, type = 'journalArticle') => ({
  key,
  data: {
    key, itemType: type, title,
    creators: [{ creatorType: 'author', lastName: 'Vaswani', firstName: 'A' }],
    date: '2017-06-12', abstractNote: 'We propose the Transformer',
  },
})

describe('zotero-client.listPapers', () => {
  it('maps Zotero items to Paper[] and filters out attachments', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([
        sampleItem('AAA', 'Attention Is All You Need'),
        { key: 'ATT1', data: { key: 'ATT1', itemType: 'attachment', title: 'x.pdf' } },
      ]), { status: 200, headers: { 'Total-Results': '2' } })
    )
    const client = createZoteroClient({ apiKey: 'k', userId: '123', fetch })
    const papers = await client.listPapers()

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toContain('/users/123/items')
    expect((init!.headers as Record<string, string>)['Zotero-API-Key']).toBe('k')
    expect(papers).toHaveLength(1)
    expect(papers[0]).toMatchObject({ key: 'AAA', title: 'Attention Is All You Need', year: 2017 })
    expect(papers[0].authors).toEqual(['A Vaswani'])
  })

  it('throws a helpful error on 403', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('Forbidden', { status: 403 }))
    const client = createZoteroClient({ apiKey: 'bad', userId: '123', fetch })
    await expect(client.listPapers()).rejects.toThrow(/Zotero.*403/)
  })

  it('scopes the request to a collection when collectionKey is given', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([sampleItem('AAA', 'T')]), { status: 200 }))
    const client = createZoteroClient({ apiKey: 'k', userId: '123', fetch })
    await client.listPapers('COL1')
    expect(String(fetch.mock.calls[0]![0])).toContain('/users/123/collections/COL1/items')
  })
})

describe('zotero-client.listCollections', () => {
  it('maps collections to {key, name, parentKey} with null for top-level', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([
        { key: 'C1', data: { key: 'C1', name: '机器学习', parentCollection: false } },
        { key: 'C2', data: { key: 'C2', name: 'LLM', parentCollection: 'C1' } },
      ]), { status: 200 })
    )
    const client = createZoteroClient({ apiKey: 'k', userId: '123', fetch })
    const cols = await client.listCollections()
    expect(String(fetch.mock.calls[0]![0])).toContain('/users/123/collections')
    expect(cols).toEqual([
      { key: 'C1', name: '机器学习', parentKey: null },
      { key: 'C2', name: 'LLM', parentKey: 'C1' },
    ])
  })

  it('throws on non-ok', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('x', { status: 500 }))
    const client = createZoteroClient({ apiKey: 'k', userId: '123', fetch })
    await expect(client.listCollections()).rejects.toThrow(/Zotero.*500/)
  })
})

describe('zotero-client.findPdfAttachment', () => {
  it('returns the first PDF child attachment key', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([
        { key: 'C1', data: { key: 'C1', itemType: 'attachment', contentType: 'text/html' } },
        { key: 'C2', data: { key: 'C2', itemType: 'attachment', contentType: 'application/pdf' } },
      ]), { status: 200 })
    )
    const client = createZoteroClient({ apiKey: 'k', userId: '1', fetch })
    const key = await client.findPdfAttachment('PARENT')
    expect(fetch.mock.calls[0]![0]).toContain('/items/PARENT/children')
    expect(key).toBe('C2')
  })

  it('returns null when no pdf child exists', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([]), { status: 200 }))
    const client = createZoteroClient({ apiKey: 'k', userId: '1', fetch })
    expect(await client.findPdfAttachment('PARENT')).toBeNull()
  })
})

describe('zotero-client.findPdfAttachmentInfo', () => {
  it('returns the first PDF child key + filename', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([
        { key: 'C1', data: { key: 'C1', itemType: 'attachment', contentType: 'text/html', filename: 'x.html' } },
        { key: 'C2', data: { key: 'C2', itemType: 'attachment', contentType: 'application/pdf', filename: 'Paper 2024.pdf' } },
      ]), { status: 200 })
    )
    const client = createZoteroClient({ apiKey: 'k', userId: '1', fetch })
    const info = await client.findPdfAttachmentInfo('PARENT')
    expect(fetch.mock.calls[0]![0]).toContain('/items/PARENT/children')
    expect(info).toEqual({ key: 'C2', filename: 'Paper 2024.pdf' })
  })

  it('returns null when no pdf child exists', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([]), { status: 200 }))
    const client = createZoteroClient({ apiKey: 'k', userId: '1', fetch })
    expect(await client.findPdfAttachmentInfo('PARENT')).toBeNull()
  })
})

describe('zotero-client.downloadAttachment', () => {
  it('fetches the file endpoint and returns bytes', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(bytes, { status: 200 }))
    const client = createZoteroClient({ apiKey: 'k', userId: '1', fetch })
    const buf = await client.downloadAttachment('C2')
    expect(fetch.mock.calls[0]![0]).toContain('/items/C2/file')
    expect(new Uint8Array(buf).slice(0, 4)).toEqual(bytes)
  })
})
