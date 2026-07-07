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

  // collectionKey 为空 = 整库；否则只取该文件夹（collection）内条目
  async function listPapers(collectionKey?: string | null, limit = 100): Promise<Paper[]> {
    const scope = collectionKey ? `collections/${collectionKey}/items` : 'items'
    const url = `${base}/users/${deps.userId}/${scope}?limit=${limit}&sort=dateModified&direction=desc`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero listPapers failed: ${res.status}`)
    const items = (await res.json()) as ZoteroItem[]
    return items.filter(i => PAPER_TYPES.has(i.data.itemType)).map(toPaper)
  }

  async function listCollections(): Promise<Array<{ key: string; name: string; parentKey: string | null }>> {
    const url = `${base}/users/${deps.userId}/collections?limit=200`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero listCollections failed: ${res.status}`)
    const cols = (await res.json()) as Array<{ data: { key: string; name: string; parentCollection?: string | false } }>
    return cols.map(c => ({
      key: c.data.key,
      name: c.data.name,
      parentKey: c.data.parentCollection ? c.data.parentCollection : null,
    }))
  }

  async function findPdfAttachment(parentKey: string): Promise<string | null> {
    const url = `${base}/users/${deps.userId}/items/${parentKey}/children`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero children failed: ${res.status}`)
    const children = (await res.json()) as Array<{ data: { key: string; itemType: string; contentType?: string } }>
    const pdf = children.find(c => c.data.itemType === 'attachment' && c.data.contentType === 'application/pdf')
    return pdf ? pdf.data.key : null
  }

  async function findPdfAttachmentInfo(parentKey: string): Promise<{ key: string; filename: string } | null> {
    const url = `${base}/users/${deps.userId}/items/${parentKey}/children`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero children failed: ${res.status}`)
    const children = (await res.json()) as Array<{ data: { key: string; itemType: string; contentType?: string; filename?: string } }>
    const pdf = children.find(c => c.data.itemType === 'attachment' && c.data.contentType === 'application/pdf')
    return pdf ? { key: pdf.data.key, filename: pdf.data.filename ?? '' } : null
  }

  async function downloadAttachment(attachmentKey: string): Promise<ArrayBuffer> {
    const url = `${base}/users/${deps.userId}/items/${attachmentKey}/file`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero file download failed: ${res.status}`)
    return res.arrayBuffer()
  }

  /** 创建一个条目（如 annotation 高亮），返回新条目 key。需要写权限的 API key。 */
  async function createAnnotation(item: object): Promise<string> {
    const url = `${base}/users/${deps.userId}/items`
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify([item]),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Zotero createAnnotation failed: ${res.status} — ${body.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      successful?: Record<string, { key: string }>
      failed?: Record<string, { message?: string }>
    }
    const failed = data.failed && Object.values(data.failed)[0]
    if (failed) throw new Error(`Zotero createAnnotation failed: ${failed.message ?? 'unknown'}`)
    const ok = data.successful && Object.values(data.successful)[0]
    if (!ok?.key) throw new Error('Zotero createAnnotation: no key in response')
    return ok.key
  }

  return { listPapers, listCollections, findPdfAttachment, findPdfAttachmentInfo, downloadAttachment, createAnnotation }
}
