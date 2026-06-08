import { describe, it, expect, vi } from 'vitest'
import { createNotionSync } from '../../src/main/services/notion-sync'
import type { Note, Paper } from '@shared/types'

const paper: Paper = { key: 'P1', title: 'T', authors: ['A'], year: 2020, abstract: '', attachmentKey: null }
const note: Note = { id: 'n1', paperKey: 'P1', content: 'c', tags: [], createdAt: 1, notionPageId: null }

describe('createNotionSync.sync', () => {
  it('creates a new page when note has no notionPageId', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'new-page-1' }), { status: 200 })
    )
    const sync = createNotionSync({ token: 't', databaseId: 'db', fetch })
    const pageId = await sync.sync(note, paper)

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.notion.com/v1/pages')
    expect(init!.method).toBe('POST')
    expect((init!.headers as any)['Notion-Version']).toBe('2022-06-28')
    expect((init!.headers as any)['Authorization']).toBe('Bearer t')
    expect(pageId).toBe('new-page-1')
  })

  it('patches existing page when note already synced', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'p9' }), { status: 200 }))
    const sync = createNotionSync({ token: 't', databaseId: 'db', fetch })
    await sync.sync({ ...note, notionPageId: 'p9' }, paper)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.notion.com/v1/pages/p9')
    expect(init!.method).toBe('PATCH')
  })

  it('throws with notion error detail on failure', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ message: 'invalid db' }), { status: 400 })
    )
    const sync = createNotionSync({ token: 't', databaseId: 'db', fetch })
    await expect(sync.sync(note, paper)).rejects.toThrow(/Notion.*400.*invalid db/)
  })
})
