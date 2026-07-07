// MANUAL real-API smoke for the AI-capabilities features (self-skips without creds).
// Verifies against LIVE DeepSeek (+ local ~/Zotero for real paper text):
//   1) deep-think mode (thinking.type=enabled) streams `reasoning_content` → our kind callback fires
//   2) real tag generation: model obeys the JSON-array prompt and parseTags parses it
//   3) real deep-read chain: real paper text → streamed five-section note → tags →
//      saved via the REAL notesRepo (in-memory sqlite)
// Run: DEEPSEEK_API_KEY=... [ZOTERO_USER_ID=... ZOTERO_API_KEY=...] npx vitest run tests/e2e/real-ai-caps.smoke.test.ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import {
  createAiChat, buildDeepReadMessages, buildTagMessages, parseTags,
} from '../../src/main/services/ai-chat'
import { createZoteroClient } from '../../src/main/services/zotero-client'
import { createZoteroLocal } from '../../src/main/services/zotero-local'
import { extractPdfText } from '../../src/main/services/pdf-service'
import { migrate } from '../../src/main/services/db'
import { createNotesRepo } from '../../src/main/services/notes-repo'
import type { Paper } from '@shared/types'

const E = process.env
const log = (...a: unknown[]) => console.log('[AI-CAPS]', ...a)
const short = (s: string, n = 160) => (s.length > n ? s.slice(0, n) + `… (${s.length} chars)` : s)

describe.skipIf(!E.DEEPSEEK_API_KEY)('REAL AI-capabilities smoke', () => {
  it('reasoner kind-split + real tagging + real deep-read → notesRepo', async () => {
    const ai = createAiChat({ apiKey: E.DEEPSEEK_API_KEY!, model: 'deepseek-v4-flash', fetch })

    // ---- 1) REAL deep-think (thinking.type=enabled): reasoning_content must arrive as kind='reasoning' ----
    const reasoner = createAiChat({ apiKey: E.DEEPSEEK_API_KEY!, model: 'deepseek-v4-flash', fetch, thinking: { type: 'enabled' } })
    let reasoningTokens = 0
    let contentTokens = 0
    let firstContentAfterReasoning = false
    const answer = await reasoner.stream(
      [{ role: 'user', content: '一句话：Transformer 为什么能并行训练？' }],
      (_d, kind) => {
        if (kind === 'reasoning') reasoningTokens++
        else {
          if (reasoningTokens > 0 && contentTokens === 0) firstContentAfterReasoning = true
          contentTokens++
        }
      },
    )
    log(`reasoner: ${reasoningTokens} reasoning tokens, ${contentTokens} content tokens; answer=${short(answer)}`)
    expect(reasoningTokens, 'real reasoner must emit reasoning_content deltas').toBeGreaterThan(0)
    expect(contentTokens).toBeGreaterThan(0)
    expect(firstContentAfterReasoning, 'reasoning should precede content').toBe(true)
    expect(answer.length).toBeGreaterThan(0)
    // the returned text must NOT contain the (much longer) reasoning
    expect(answer.length).toBeLessThan(2000)

    // ---- get REAL paper text (local ~/Zotero) when Zotero creds present; else fallback text ----
    let paper: Paper = { key: 'X', title: 'Attention Is All You Need', authors: ['Vaswani'], year: 2017, abstract: '', attachmentKey: null }
    let paperText = 'Transformer 用自注意力机制取代循环结构，实现并行训练。多头注意力让模型同时关注不同子空间。'
    if (E.ZOTERO_USER_ID && E.ZOTERO_API_KEY) {
      const zotero = createZoteroClient({ apiKey: E.ZOTERO_API_KEY, userId: E.ZOTERO_USER_ID, fetch })
      const local = createZoteroLocal({
        dataDir: join(os.homedir(), 'Zotero'),
        exists: (p) => fs.existsSync(p),
        readFile: (p) => new Uint8Array(fs.readFileSync(p)),
        readdir: (p) => fs.readdirSync(p),
        join: (...parts) => join(...parts),
      })
      const papers = await zotero.listPapers()
      for (const p of papers.slice(0, 8)) {
        const info = await zotero.findPdfAttachmentInfo(p.key)
        if (!info) continue
        const bytes = local.readPdf(info.key, info.filename)
        if (!bytes) continue
        paper = p
        paperText = await extractPdfText(bytes)
        log(`real paper: "${short(p.title, 60)}" → ${paperText.length} chars extracted locally`)
        break
      }
    }

    // ---- 2+3) REAL deep-read chain (context capped at 20k chars to keep cost tiny) ----
    const deepReadMsgs = buildDeepReadMessages(paper, paperText, 20_000)
    let streamed = 0
    const noteContent = await ai.stream(deepReadMsgs, (_d, kind) => { if (kind === 'content') streamed++ })
    log(`deep-read: ${streamed} tokens streamed; ${noteContent.length} chars; head=${short(noteContent.replace(/\n/g, ' '), 120)}`)
    expect(noteContent.length).toBeGreaterThan(100)
    let sections = 0
    for (const s of ['背景问题', '核心贡献', '方法', '实验与结论', '局限与展望']) {
      if (noteContent.includes(s)) sections++
    }
    log(`deep-read sections present: ${sections}/5`)
    expect(sections, 'deep-read should contain most of the five sections').toBeGreaterThanOrEqual(4)

    // real tagging on the real deep-read content
    const tagReply = await ai.complete(buildTagMessages(noteContent))
    const tags = parseTags(tagReply)
    log(`tag reply=${short(tagReply)} → parsed tags=${JSON.stringify(tags)}`)
    expect(tags.length, 'real model should yield 2-4 parseable tags').toBeGreaterThanOrEqual(2)
    expect(tags.length).toBeLessThanOrEqual(4)

    // save via the REAL notesRepo on a real (in-memory) sqlite — full production save path
    const db = new Database(':memory:')
    migrate(db)
    const repo = createNotesRepo({ db, now: () => Date.now(), genId: () => 'real-1' })
    const note = repo.add({ paperKey: paper.key, content: noteContent, tags })
    const [reloaded] = repo.listByPaper(paper.key)
    expect(reloaded.content).toBe(noteContent)
    expect(reloaded.tags).toEqual(tags)
    log(`note saved & reloaded: id=${note.id}, tags=${JSON.stringify(reloaded.tags)} ✅`)
  }, 300_000)
})
