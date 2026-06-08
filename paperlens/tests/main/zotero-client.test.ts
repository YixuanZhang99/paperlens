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
})
