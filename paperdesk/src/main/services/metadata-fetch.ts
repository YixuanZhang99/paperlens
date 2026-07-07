// 入库(L2):识别 DOI/arXiv 输入 → 公开 API 拉元数据。纯函数 + 注入 fetch,可单测。
// arXiv: export.arxiv.org Atom(正则抽字段——格式固定,主进程无 DOMParser,不为此引 XML 库)
// Crossref: api.crossref.org JSON(abstract 是 JATS XML,剥标签)

export interface FetchedMeta {
  title: string
  authors: string[]
  year: number | null
  abstract: string
  doi?: string | null
  arxivId?: string | null
  pdfUrl?: string | null
}

export type RefInput =
  | { kind: 'arxiv'; id: string }
  | { kind: 'doi'; doi: string }
  | { kind: 'unknown' }

const ARXIV_ID = /(\d{4}\.\d{4,5}(?:v\d+)?)/

export function parseRefInput(input: string): RefInput {
  const s = input.trim()
  if (!s) return { kind: 'unknown' }
  // arXiv 链接(abs/pdf)或裸号
  if (/arxiv\.org/i.test(s)) {
    const m = s.match(ARXIV_ID)
    if (m) return { kind: 'arxiv', id: m[1] }
  }
  if (new RegExp(`^${ARXIV_ID.source}$`).test(s)) return { kind: 'arxiv', id: s }
  // DOI:doi.org 链接 / doi: 前缀 / 裸 10.x/…
  const doiMatch = s.replace(/^doi:\s*/i, '').match(/(10\.\d{4,9}\/\S+)/)
  if (doiMatch) return { kind: 'doi', doi: doiMatch[1] }
  return { kind: 'unknown' }
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// 折行合并 + 压缩空白(arXiv 的 title/summary 常带换行缩进)
const squash = (s: string) => unescapeXml(s).replace(/\s+/g, ' ').trim()

export async function fetchArxivMeta(id: string, fetchFn: typeof fetch): Promise<FetchedMeta> {
  const res = await fetchFn(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`arXiv 查询失败: ${res.status}`)
  const xml = await res.text()
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1]
  if (!entry) throw new Error(`arXiv 未找到该论文: ${id}`)
  const title = squash(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '')
  if (!title) throw new Error(`arXiv 返回无标题: ${id}`)
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(m => squash(m[1]))
  const published = entry.match(/<published>(\d{4})-/)?.[1]
  const abstract = squash(entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '')
  const bareId = id.replace(/v\d+$/, '')
  return {
    title, authors, year: published ? Number(published) : null, abstract,
    arxivId: bareId, doi: null,
    pdfUrl: `https://arxiv.org/pdf/${bareId}`,
  }
}

const stripJats = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

export async function fetchCrossrefMeta(doi: string, fetchFn: typeof fetch): Promise<FetchedMeta> {
  const res = await fetchFn(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
  if (!res.ok) throw new Error(`Crossref 查询失败: ${res.status}(检查 DOI 是否正确)`)
  const data = (await res.json()) as { message?: Record<string, unknown> }
  const m = data.message ?? {}
  const title = Array.isArray(m.title) && m.title.length ? String(m.title[0]) : ''
  if (!title) throw new Error(`Crossref 返回无标题: ${doi}`)
  const authors = (Array.isArray(m.author) ? m.author : [])
    .map((a: { given?: string; family?: string }) => [a.given, a.family].filter(Boolean).join(' '))
    .filter(Boolean)
  const dateParts = (m.published as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]
  const year = dateParts && typeof dateParts[0] === 'number' ? dateParts[0] : null
  const abstract = typeof m.abstract === 'string' ? stripJats(m.abstract) : ''
  return { title, authors, year, abstract, doi, arxivId: null, pdfUrl: null }
}
