import type { Paper } from '@shared/types'

export interface ZoteroDeps {
  apiKey: string
  userId: string
  fetch: typeof fetch
  baseUrl?: string
}

interface ZoteroCreator { creatorType: string; firstName?: string; lastName?: string; name?: string }
interface ZoteroItemData {
  key: string; itemType: string; title?: string
  creators?: ZoteroCreator[]; date?: string; abstractNote?: string
}
interface ZoteroItem { key: string; data: ZoteroItemData }

const PAPER_TYPES = new Set([
  'journalArticle', 'conferencePaper', 'preprint', 'book', 'bookSection', 'report', 'thesis',
])

function authorName(c: ZoteroCreator): string {
  if (c.name) return c.name
  return [c.firstName, c.lastName].filter(Boolean).join(' ')
}

function yearFromDate(date?: string): number | null {
  if (!date) return null
  const m = date.match(/\d{4}/)
  return m ? Number(m[0]) : null
}

function toPaper(item: ZoteroItem): Paper {
  const d = item.data
  return {
    key: d.key,
    title: d.title ?? '(无标题)',
    authors: (d.creators ?? []).filter(c => c.creatorType === 'author').map(authorName),
    year: yearFromDate(d.date),
    abstract: d.abstractNote ?? '',
    attachmentKey: null,
  }
}

export function createZoteroClient(deps: ZoteroDeps) {
  const base = deps.baseUrl ?? 'https://api.zotero.org'
  const headers = { 'Zotero-API-Key': deps.apiKey, 'Zotero-API-Version': '3' }

  async function listPapers(limit = 100): Promise<Paper[]> {
    const url = `${base}/users/${deps.userId}/items?limit=${limit}&sort=dateModified&direction=desc`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero listPapers failed: ${res.status}`)
    const items = (await res.json()) as ZoteroItem[]
    return items.filter(i => PAPER_TYPES.has(i.data.itemType)).map(toPaper)
  }

  async function findPdfAttachment(parentKey: string): Promise<string | null> {
    const url = `${base}/users/${deps.userId}/items/${parentKey}/children`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero children failed: ${res.status}`)
    const children = (await res.json()) as Array<{ data: { key: string; itemType: string; contentType?: string } }>
    const pdf = children.find(c => c.data.itemType === 'attachment' && c.data.contentType === 'application/pdf')
    return pdf ? pdf.data.key : null
  }

  async function downloadAttachment(attachmentKey: string): Promise<ArrayBuffer> {
    const url = `${base}/users/${deps.userId}/items/${attachmentKey}/file`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero file download failed: ${res.status}`)
    return res.arrayBuffer()
  }

  return { listPapers, findPdfAttachment, downloadAttachment }
}
