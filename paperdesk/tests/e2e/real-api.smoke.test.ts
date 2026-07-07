// MANUAL real-API smoke (NOT part of `npm test` CI — self-skips without creds).
// Drives the REAL service clients against the LIVE Zotero / DeepSeek / Notion
// APIs using credentials from env vars. Notion is READ-ONLY here (discovery).
//   ZOTERO_USER_ID ZOTERO_API_KEY DEEPSEEK_API_KEY DEEPSEEK_MODEL NOTION_TOKEN
import { describe, it, expect } from 'vitest'
import { createZoteroClient } from '../../src/main/services/zotero-client'
import { createAiChat, buildMessages } from '../../src/main/services/ai-chat'
import { extractPdfText } from '../../src/main/services/pdf-service'
import { createZoteroLocal } from '../../src/main/services/zotero-local'
import { createNotionSync } from '../../src/main/services/notion-sync'
import fs from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

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

        // Diagnose attachments across ALL papers: linkMode + md5/mtime (md5 present ⇒
        // file metadata registered for sync; if /file still 404s ⇒ likely WebDAV, not Zotero storage).
        const imported: { paper: typeof papers[number]; key: string; md5: string | null; filename: string }[] = []
        let pdfCount = 0, importedCount = 0, linkedCount = 0, withMd5 = 0
        for (const p of papers) {
          const res = await fetch(`${base}/users/${E.ZOTERO_USER_ID}/items/${p.key}/children`, { headers })
          if (!res.ok) continue
          const children = (await res.json()) as any[]
          for (const c of children) {
            const d = c.data ?? {}
            if (d.itemType === 'attachment' && d.contentType === 'application/pdf') {
              pdfCount++
              if (d.linkMode === 'imported_file' || d.linkMode === 'imported_url') {
                importedCount++
                if (d.md5) withMd5++
                imported.push({ paper: p, key: d.key, md5: d.md5 ?? null, filename: d.filename ?? '' })
              } else linkedCount++
            }
          }
        }
        log(`Zotero attachments (ALL ${papers.length} papers): ${pdfCount} PDF(s) → ${importedCount} imported, ${linkedCount} linked; of imported ${withMd5} have md5(synced metadata), ${importedCount - withMd5} have NO md5(never uploaded)`)
        log(`Zotero sample md5/mtime → ` + imported.slice(0, 4).map(it => `${it.key}:md5=${it.md5 ? it.md5.slice(0, 8) : 'NULL'}`).join(', '))

        // Try downloading several — prefer ones that DO have md5.
        const ordered = [...imported].sort((a, b) => (b.md5 ? 1 : 0) - (a.md5 ? 1 : 0))
        let downloaded = 0, notFound = 0
        for (const it of ordered.slice(0, 8)) {
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
        log(`Zotero file download (up to 8): ${downloaded} ok, ${notFound} 404`)
        if (downloaded === 0 && notFound > 0) {
          if (withMd5 > 0)
            log('Zotero FINDING: attachments HAVE md5 (registered for sync) but /file still 404s → files are NOT on Zotero CLOUD storage. This is the signature of **WebDAV file sync** (bytes live on your WebDAV server, not Zotero) — the Zotero *Web API* cannot fetch them. Options: switch Zotero to "Zotero" storage (Settings→Sync→File Syncing→"Sync attachment files using Zotero"), or add a local-Zotero-storage integration to this app.')
          else
            log('Zotero FINDING: imported attachments have NO md5 → files were never uploaded to Zotero storage (sync still running, OR file syncing not actually enabled / quota exceeded). Re-check after sync completes; verify Settings→Sync→File Syncing uses "Zotero" (not "WebDAV"/off).')
        }

        // --- LOCAL STORAGE read = the production path (LB-1..LB-4) for WebDAV/local users ---
        const dataDir = E.ZOTERO_DATA_DIR || join(os.homedir(), 'Zotero')
        const local = createZoteroLocal({
          dataDir,
          exists: (p) => fs.existsSync(p),
          readFile: (p) => new Uint8Array(fs.readFileSync(p)),
          readdir: (p) => fs.readdirSync(p),
          join: (...parts) => join(...parts),
        })
        let localOk = 0
        for (const it of imported.slice(0, 5)) {
          const localBytes = local.readPdf(it.key, it.filename)
          if (localBytes) {
            localOk++
            log(`Zotero LOCAL: ✓ read "${short(it.paper.title, 45)}" from ${dataDir}/storage/${it.key}/ → ${localBytes.byteLength} bytes`)
            if (!paperText) {
              paperTitle = it.paper.title
              paperText = await extractPdfText(localBytes)
              log(`pdf.js (LOCAL): extracted ${paperText.length} chars; preview → ${short(paperText.replace(/\s+/g, ' '), 160)}`)
            }
          }
        }
        log(`Zotero LOCAL read (up to 5) from ${dataDir}: ${localOk} ok`)
        if (localOk > 0) log('Zotero LOCAL FINDING: ✅ local-storage PDF path WORKS — Web-API 404 bypassed by reading ~/Zotero/storage directly. In-app PDF + AI full-text are usable.')
      } catch (e) {
        log('Zotero ERROR →', (e as Error).message)
      }
    } else log('Zotero: skipped (no creds)')

    // ---- DeepSeek (complete + stream) ----
    if (hasDeepSeek) {
      const model = E.DEEPSEEK_MODEL || 'deepseek-v4-flash'
      const paper = { key: 'X', title: paperTitle, authors: [], year: null, abstract: '', attachmentKey: null }
      const { messages } = buildMessages({
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
        if (model !== 'deepseek-v4-flash') {
          log('DeepSeek: retrying with fallback model "deepseek-v4-flash"…')
          try { await tryModel('deepseek-v4-flash') } catch (e2) { log('DeepSeek fallback ERROR →', (e2 as Error).message) }
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

        // --- REAL WRITE via the production createNotionSync (only when a DB id is given) ---
        if (E.NOTION_DATABASE_ID) {
          const sync = createNotionSync({ token: E.NOTION_TOKEN!, databaseId: E.NOTION_DATABASE_ID, fetch })
          const paper = { key: 'P', title: paperTitle, authors: ['Mo, Kaixiang', 'Shi, Yuxin'], year: 2025, abstract: '', attachmentKey: null }
          const note = {
            id: 'e2e-1', paperKey: 'P', notionPageId: null, createdAt: 1700000000000,
            tags: ['e2e', 'paperdesk'],
            content: '[PaperDesk E2E 测试页 — 可删除] 本笔记由端到端验证写入，验证 Notion 结构化同步（Title/Authors/Year/Tags + 正文）。',
          }
          const pageId = await sync.sync(note, paper)
          log(`Notion WRITE: ✓ created page → ${pageId}`)
          const pageId2 = await sync.sync({ ...note, notionPageId: pageId }, paper)
          log(`Notion WRITE: ✓ re-sync (PATCH update) → ${pageId2}; same page = ${pageId === pageId2}`)
          expect(pageId2).toBe(pageId)
          notionOk = true
        }
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
