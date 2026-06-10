// End-to-end integration: the REAL service clients driven over a REAL HTTP
// socket (real global fetch, not vi.fn) against a local server that mimics the
// Zotero / DeepSeek / Notion endpoints — plus REAL pdf.js text extraction on a
// hand-built valid PDF (no injected loader). This exercises the actual network
// I/O, JSON/SSE parsing, and pdf parsing that the unit tests mock out.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createZoteroClient } from '../../src/main/services/zotero-client'
import { createAiChat, buildMessages } from '../../src/main/services/ai-chat'
import { createNotionSync, noteToNotionPage } from '../../src/main/services/notion-sync'
import { extractPdfText } from '../../src/main/services/pdf-service'
import type { Note, Paper } from '@shared/types'

// --- a minimal but VALID single-page PDF with a correct xref table ---
function makePdf(text: string): Buffer {
  const parts: Buffer[] = []
  let pos = 0
  const offsets: number[] = []
  const push = (s: string) => { const b = Buffer.from(s, 'latin1'); parts.push(b); pos += b.length }
  const obj = (n: number, body: string) => { offsets[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`) }
  push('%PDF-1.4\n')
  const content = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`
  obj(1, '<</Type/Catalog/Pages 2 0 R>>')
  obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>')
  obj(3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>')
  obj(4, `<</Length ${content.length}>>\nstream\n${content}\nendstream`)
  obj(5, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>')
  const xrefPos = pos
  let xref = 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  push(xref)
  push(`trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`)
  return Buffer.concat(parts)
}

const PDF_TEXT = 'Hello End To End PDF'
const PDF_BYTES = makePdf(PDF_TEXT)

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => resolve(b))
  })
}

let server: Server
let base = ''
const seen: { notionMethods: string[] } = { notionMethods: [] }

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? ''
    const method = req.method ?? 'GET'

    // --- Zotero Web API ---
    if (method === 'GET' && url.includes('/users/123/items/PARENT/children')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify([
        { key: 'HTMLATT', data: { key: 'HTMLATT', itemType: 'attachment', contentType: 'text/html' } },
        { key: 'PDFATT', data: { key: 'PDFATT', itemType: 'attachment', contentType: 'application/pdf' } },
      ]))
    }
    if (method === 'GET' && url.includes('/users/123/items/PDFATT/file')) {
      res.writeHead(200, { 'Content-Type': 'application/pdf' })
      return res.end(PDF_BYTES)
    }
    if (method === 'GET' && url.includes('/users/123/items')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Total-Results': '1' })
      return res.end(JSON.stringify([
        {
          key: 'PARENT',
          data: {
            key: 'PARENT', itemType: 'journalArticle', title: 'Attention Is All You Need',
            creators: [{ creatorType: 'author', firstName: 'A', lastName: 'Vaswani' }],
            date: '2017-06-12', abstractNote: 'We propose the Transformer.',
          },
        },
      ]))
    }

    // --- DeepSeek (OpenAI-compatible) ---
    if (method === 'POST' && url.endsWith('/chat/completions')) {
      const body = JSON.parse(await readBody(req))
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        // emit several SSE chunks, including a multi-token line and [DONE]
        res.write('data: {"choices":[{"delta":{"content":"Transformer "}}]}\n\n')
        res.write('data: {"choices":[{"delta":{"content":"用自注意力"}}]}\n\n')
        res.write('data: {"choices":[{"delta":{"content":"取代了RNN。"}}]}\n\n')
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '这篇论文提出了 Transformer。' } }],
      }))
    }

    // --- Notion ---
    if (method === 'POST' && url.endsWith('/v1/pages')) {
      seen.notionMethods.push('POST')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ id: 'notion-page-1' }))
    }
    if (method === 'PATCH' && url.startsWith('/v1/pages/')) {
      seen.notionMethods.push('PATCH')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ id: 'notion-page-1' }))
    }

    res.writeHead(404)
    res.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('E2E: full data flow over real HTTP + real pdf.js', () => {
  it('Zotero → PDF bytes → real pdf.js text → DeepSeek (complete + stream) → Notion (create + update)', async () => {
    // 1) Zotero: list papers over real HTTP
    const zotero = createZoteroClient({ apiKey: 'zkey', userId: '123', fetch, baseUrl: base })
    const papers = await zotero.listPapers()
    expect(papers).toHaveLength(1)
    const paper: Paper = papers[0]
    expect(paper).toMatchObject({ key: 'PARENT', title: 'Attention Is All You Need', year: 2017 })
    expect(paper.authors).toEqual(['A Vaswani'])

    // 2) Zotero: resolve PDF attachment + download real bytes
    const attKey = await zotero.findPdfAttachment(paper.key)
    expect(attKey).toBe('PDFATT')
    const bytes = await zotero.downloadAttachment(attKey!)
    const u8 = new Uint8Array(bytes)
    expect(Buffer.from(u8.slice(0, 5)).toString('latin1')).toBe('%PDF-') // real PDF header

    // 3) REAL pdf.js extraction (no injected loader) on the downloaded bytes
    const text = await extractPdfText(u8)
    expect(text).toContain('Hello')
    expect(text).toContain('PDF')

    // 4) DeepSeek non-streaming complete over real HTTP
    const ai = createAiChat({ apiKey: 'dkey', model: 'deepseek-chat', fetch, baseUrl: base })
    const { messages } = buildMessages({ paper, paperText: text, history: [], userInput: '这篇论文的核心贡献是什么？' })
    const reply = await ai.complete(messages)
    expect(reply).toBe('这篇论文提出了 Transformer。')

    // 5) DeepSeek streaming over a real SSE socket — tokens arrive incrementally
    const tokens: string[] = []
    const full = await ai.stream(messages, (d) => tokens.push(d))
    expect(tokens).toEqual(['Transformer ', '用自注意力', '取代了RNN。'])
    expect(full).toBe('Transformer 用自注意力取代了RNN。')

    // 6) Notion: create a page from a note over real HTTP
    const notion = createNotionSync({ token: 'ntoken', databaseId: 'db-1', fetch, baseUrl: base })
    const note: Note = {
      id: 'n1', paperKey: paper.key, content: full, tags: ['transformer', 'nlp'],
      createdAt: 1700000000000, notionPageId: null,
    }
    // sanity: the payload mapper produces the typed properties
    const page = noteToNotionPage(note, paper, 'db-1')
    expect(page.properties.Title.title[0].text.content).toBe('Attention Is All You Need')

    const pageId = await notion.sync(note, paper)
    expect(pageId).toBe('notion-page-1')

    // 7) Notion: re-sync the now-synced note → PATCH (update), not a second POST
    const pageId2 = await notion.sync({ ...note, notionPageId: pageId }, paper)
    expect(pageId2).toBe('notion-page-1')
    expect(seen.notionMethods).toEqual(['POST', 'PATCH'])
  })
})
