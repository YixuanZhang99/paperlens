import { describe, it, expect, vi } from 'vitest'
import { buildAnnotationSortIndex, buildAnnotationPayload } from '../../src/main/services/zotero-annotation'
import { createZoteroClient } from '../../src/main/services/zotero-client'

describe('buildAnnotationSortIndex', () => {
  it('pads page / offset / top into the fixed-width format', () => {
    expect(buildAnnotationSortIndex(0, 0)).toBe('00000|000000|00000')
    expect(buildAnnotationSortIndex(3, 742)).toBe('00003|000000|00742')
  })
  it('rounds and floors negatives to 0', () => {
    expect(buildAnnotationSortIndex(2.4, -5)).toBe('00002|000000|00000')
  })
})

describe('buildAnnotationPayload', () => {
  const hl = {
    pageIndex: 2,
    rects: [[100, 700, 200, 712]], // PDF 坐标，y 越大越靠上
    text: 'self-attention',
    color: '#ffd400',
    comment: '关键定义',
  }

  it('maps a highlight to a Zotero annotation item', () => {
    const p = buildAnnotationPayload(hl, 'ATTACH1', 792)
    expect(p.itemType).toBe('annotation')
    expect(p.parentItem).toBe('ATTACH1')
    expect(p.annotationType).toBe('highlight')
    expect(p.annotationText).toBe('self-attention')
    expect(p.annotationComment).toBe('关键定义')
    expect(p.annotationColor).toBe('#ffd400')
    expect(p.annotationPageLabel).toBe('3') // pageIndex+1
    const pos = JSON.parse(p.annotationPosition)
    expect(pos).toEqual({ pageIndex: 2, rects: [[100, 700, 200, 712]] })
  })

  it('top in sortIndex is pageHeight - rectTopY (=792-712=80)', () => {
    const p = buildAnnotationPayload(hl, 'A', 792)
    expect(p.annotationSortIndex).toBe('00002|000000|00080')
  })

  it('defaults a missing comment to empty string', () => {
    const p = buildAnnotationPayload({ ...hl, comment: null }, 'A', 792)
    expect(p.annotationComment).toBe('')
  })
})

describe('zoteroClient.createAnnotation', () => {
  it('POSTs the annotation and returns the new item key', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ successful: { '0': { key: 'NEWKEY9' } }, failed: {} }), { status: 200 }))
    const z = createZoteroClient({ apiKey: 'k', userId: '42', fetch })
    const key = await z.createAnnotation(buildAnnotationPayload(
      { pageIndex: 0, rects: [[1, 2, 3, 4]], text: 't', color: '#ffd400', comment: null }, 'ATT', 800))

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.zotero.org/users/42/items')
    expect(init!.method).toBe('POST')
    expect((init!.headers as any)['Zotero-API-Key']).toBe('k')
    const body = JSON.parse(init!.body as string)
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].itemType).toBe('annotation')
    expect(key).toBe('NEWKEY9')
  })

  it('throws when Zotero rejects the write (e.g. read-only key)', async () => {
    const fetch = vi.fn(async () => new Response('Forbidden', { status: 403 }))
    const z = createZoteroClient({ apiKey: 'ro', userId: '42', fetch })
    await expect(
      z.createAnnotation(buildAnnotationPayload(
        { pageIndex: 0, rects: [[1, 2, 3, 4]], text: 't', color: '#ffd400', comment: null }, 'ATT', 800)),
    ).rejects.toThrow(/403/)
  })

  it('throws when the item is reported as failed', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ successful: {}, failed: { '0': { message: 'bad' } } }), { status: 200 }))
    const z = createZoteroClient({ apiKey: 'k', userId: '42', fetch })
    await expect(
      z.createAnnotation(buildAnnotationPayload(
        { pageIndex: 0, rects: [[1, 2, 3, 4]], text: 't', color: '#ffd400', comment: null }, 'ATT', 800)),
    ).rejects.toThrow(/bad|failed/i)
  })
})
