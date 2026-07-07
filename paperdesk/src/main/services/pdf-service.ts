interface FakePage { getTextContent(): Promise<{ items: Array<{ str: string }> }> }
interface FakeDoc { numPages: number; getPage(n: number): Promise<FakePage> }

export interface ExtractOptions {
  loadDocument?: (data: Uint8Array) => Promise<FakeDoc>
  maxChars?: number
  pageMarkers?: boolean   // true：每页前注入 [第N页]，供对话引用定位；默认 false（KB/精读纯文本）
}

// 真实加载器：延迟引入 pdfjs，避免污染单测环境
async function realLoadDocument(data: Uint8Array): Promise<FakeDoc> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data })
  return (await task.promise) as unknown as FakeDoc
}

export async function extractPdfText(bytes: Uint8Array, opts: ExtractOptions = {}): Promise<string> {
  const load = opts.loadDocument ?? realLoadDocument
  const maxChars = opts.maxChars ?? 120_000
  const doc = await load(bytes)
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const body = content.items.map(it => it.str).join(' ')
    pages.push(opts.pageMarkers ? `[第${i}页]\n${body}` : body)
    if (pages.join('\n').length >= maxChars) break
  }
  return pages.join('\n').slice(0, maxChars)
}
