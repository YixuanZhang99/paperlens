// MANUAL real-API smoke (NOT part of `npm test` CI — self-skips without creds).
// Drives the REAL service clients against the LIVE Zotero / DeepSeek / Notion
// APIs using credentials from env vars. Notion is READ-ONLY here (discovery).
//   ZOTERO_USER_ID ZOTERO_API_KEY DEEPSEEK_API_KEY DEEPSEEK_MODEL NOTION_TOKEN
import { describe, it, expect } from 'vitest'
import { createZoteroClient } from '../../src/main/services/zotero-client'
import { createAiChat, buildMessages } from '../../src/main/services/ai-chat'
import { extractPdfText } from '../../src/main/services/pdf-service'

const E = process.env
const hasZotero = !!(E.ZOTERO_USER_ID && E.ZOTERO_API_KEY)
const hasDeepSeek = !!E.DEEPSEEK_API_KEY
const hasNotion = !!E.NOTION_TOKEN
const log = (...a: unknown[]) => console.log('[REAL-API]', ...a)
const short = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + `… (${s.length} chars)` : s)

describe.skipIf(!(hasZotero || hasDeepSeek || hasNotion))('REAL API smoke', () => {
  it('Zotero → PDF → pdf.js → DeepSeek (complete+stream) → Notion discovery', async () => {
    let paperText = ''
    let paperTitle = 'Transformer (synthetic fallback)'
    let deepseekOk = false
    let notionOk = false

    // ---- Zotero (read-only) ----
    let zoteroOk = false
    if (hasZotero) {
      const base = 'https://api.zotero.org'
      const headers = { 'Zotero-API-Key': E.ZOTERO_API_KEY!, 'Zotero-API-Version': '3' }
      try {
        const zotero = createZoteroClient({ apiKey: E.ZOTERO_API_KEY!, userId: E.ZOTERO_USER_ID!, fetch })
        const papers = await zotero.listPapers()
        zoteroOk = papers.length > 0
        log(`Zotero: listed ${papers.length} papers`)
        log('Zotero: first 3 →', papers.slice(0, 3).map(p => `"${short(p.title, 50)}" (${p.year ?? '?'})`))

        // Diagnose attachments: imported vs linked, and how many actually have a cloud file.
        const imported: { paper: typeof papers[number]; key: string }[] = []
        let pdfCount = 0, importedCount = 0, linkedCount = 0
        for (const p of papers.slice(0, 12)) {
          const res = await fetch(`${base}/users/${E.ZOTERO_USER_ID}/items/${p.key}/children`, { headers })
          if (!res.ok) continue
          const children = (await res.json()) as any[]
          for (const c of children) {
            const d = c.data ?? {}
            if (d.itemType === 'attachment' && d.contentType === 'application/pdf') {
              pdfCount++
              if (d.linkMode === 'imported_file' || d.linkMode === 'imported_url') { importedCount++; imported.push({ paper: p, key: d.key }) }
              else linkedCount++
            }
          }
        }
        log(`Zotero attachments (first 12 papers): ${pdfCount} PDF(s) → ${importedCount} imported, ${linkedCount} linked`)

        // Try to actually fetch the bytes for up to 5 imported PDFs — distinguishes
        // "imported but not uploaded to Zotero cloud (404)" from "downloadable".
        let downloaded = 0, notFound = 0
        for (const it of imported.slice(0, 5)) {
          try {
            const buf = await zotero.downloadAttachment(it.key)
            const u8 = new Uint8Array(buf)
            downloaded++
            log(`Zotero: ✓ downloaded "${short(it.paper.title, 50)}" → ${u8.byteLength} bytes (${Buffer.from(u8.slice(0,5)).toString('latin1')})`)
            if (!paperText) {
              paperTitle = it.paper.title
              paperText = await extractPdfText(u8)
              log(`pdf.js: extracted ${paperText.length} chars; preview → ${short(paperText.replace(/\s+/g, ' '), 160)}`)
            }
            break
          } catch (e) {
            if ((e as Error).message.includes('404')) notFound++
            else log(`Zotero download error → ${(e as Error).message}`)
          }
        }
        log(`Zotero file download (up to 5 imported): ${downloaded} ok, ${notFound} 404 (no cloud file)`)
        if (downloaded === 0 && notFound > 0) {
          log('Zotero FINDING: imported PDFs exist but their FILES are NOT on Zotero cloud storage (every /file → 404). The Zotero *Web API* can only fetch files that were uploaded via Zotero file-sync. → Enable Zotero file syncing (Settings → Sync → "Sync attachment files"), OR switch this app to a local-Zotero-storage integration. In-app PDF reading + AI full-text need the file; chat still works on metadata.')
        }
      } catch (e) {
        log('Zotero ERROR →', (e as Error).message)
      }
    } else log('Zotero: skipped (no creds)')

    // ---- DeepSeek (complete + stream) ----
    if (hasDeepSeek) {
      const model = E.DEEPSEEK_MODEL || 'deepseek-chat'
      const paper = { key: 'X', title: paperTitle, authors: [], year: null, abstract: '', attachmentKey: null }
      const messages = buildMessages({
        paper, paperText: paperText || '（无正文，仅凭标题）', history: [],
        userInput: '用一句话说明这篇论文最核心的贡献。',
      })
      const tryModel = async (m: string) => {
        const ai = createAiChat({ apiKey: E.DEEPSEEK_API_KEY!, model: m, fetch })
        const reply = await ai.complete(messages)
        log(`DeepSeek[complete, model=${m}] → ${short(reply, 240)}`)
        const toks: string[] = []
        const full = await ai.stream(messages, d => toks.push(d))
        log(`DeepSeek[stream, model=${m}] → ${toks.length} tokens; text=${short(full, 240)}`)
        if (full.length > 0) deepseekOk = true
      }
      try {
        await tryModel(model)
      } catch (e) {
        log(`DeepSeek ERROR with model="${model}" → ${(e as Error).message}`)
        if (model !== 'deepseek-chat') {
          log('DeepSeek: retrying with fallback model "deepseek-chat"…')
          try { await tryModel('deepseek-chat') } catch (e2) { log('DeepSeek fallback ERROR →', (e2 as Error).message) }
        }
      }
    } else log('DeepSeek: skipped (no creds)')

    // ---- Notion (READ-ONLY discovery; no write) ----
    if (hasNotion) {
      try {
        const res = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${E.NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 20 }),
        })
        const data = (await res.json()) as any
        if (!res.ok) { throw new Error(`Notion search ${res.status}: ${short(JSON.stringify(data), 160)}`) }
        notionOk = true
        const dbs = (data.results ?? []) as any[]
        log(`Notion: integration can access ${dbs.length} database(s)`)
        for (const db of dbs) {
          const title = (db.title?.[0]?.plain_text) || '(untitled)'
          const props = Object.entries(db.properties ?? {}).map(([k, v]: [string, any]) => `${k}:${v.type}`)
          log(`Notion DB → id=${db.id} title="${title}" props=[${props.join(', ')}]`)
          const have = new Set(Object.entries(db.properties ?? {}).map(([k, v]: [string, any]) => `${k}:${v.type}`))
          const need = ['Title:title', 'Authors:rich_text', 'Year:number', 'Tags:multi_select']
          const missing = need.filter(n => !have.has(n))
          log(`Notion DB schema check → ${missing.length === 0 ? 'OK (matches required columns)' : 'MISSING ' + missing.join(', ')}`)
        }
        if (dbs.length === 0) log('Notion: token valid but NO database is shared with the integration (connect one in the DB ••• → Connections).')
      } catch (e) {
        log('Notion ERROR →', (e as Error).message)
      }
    } else log('Notion: skipped (no creds)')

    // ---- summary: assert the reachable live APIs actually responded ----
    log(`SUMMARY → zoteroList=${zoteroOk} pdfText=${paperText.length > 0} deepseek=${deepseekOk} notion=${notionOk}`)
    if (hasZotero) expect(zoteroOk, 'Zotero list API should respond').toBe(true)
    if (hasDeepSeek) expect(deepseekOk, 'DeepSeek chat API should respond').toBe(true)
    if (hasNotion) expect(notionOk, 'Notion API should respond').toBe(true)
  }, 120000)
})
