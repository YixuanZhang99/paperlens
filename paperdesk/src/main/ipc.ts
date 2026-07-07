import { ipcMain, app, shell } from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'
import type { Container } from './container'
import { extractPdfText } from './services/pdf-service'
import { buildMessages, buildDeepReadMessages, buildTagMessages, parseTags, buildFollowupMessages, parseFollowups } from './services/ai-chat'
import { chunkPagedText, buildQueryExpansionMessages, parseQueryTerms, buildKbAnswerMessages, buildKbFollowupMessages, buildRerankMessages, parseRerankScores, groupHitsToSources, insertChunks, searchChunks, searchVector, chunksMissingEmbedding, setChunkEmbeddings, embeddingStats, kbStatus, indexedPaperKeys, representativeChunks, buildReviewMapMessages, buildReviewReduceMessages } from './services/kb'
import { buildAnnotationPayload } from './services/zotero-annotation'
import { importFromPaperLens, copyModelsDir } from './services/paperlens-import'
import { importFromZotero } from './services/zotero-import'
import { parseRefInput, fetchArxivMeta, fetchCrossrefMeta } from './services/metadata-fetch'
import { randomUUID } from 'node:crypto'
import type { AppConfig, ChatMessage, Paper } from '@shared/types'

// Zotero sortIndex 的「距页顶」只影响侧栏排序（标注在 PDF 上的落点由 annotationPosition 精确给出）。
// 我们没存每页真实高度，但 sortIndex 只需「按页内从上到下单调」即可。取一个大于任何真实页高的
// 参考值，使 top = REF - y 恒为正且随纵坐标下移而增大，A4/Letter/自定义尺寸都不会被 max(0,…) 夹平。
const SORT_REF_TOP_PT = 2000
// 同步在途守卫：避免同一论文并发/重复推送（UI 也会禁用按钮，这里是双保险）
const syncingPapers = new Set<string>()

let currentAbort: AbortController | null = null

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

// PDF bytes：本地文献库自管文件(userData/library/<pdf_path>)。无 PDF → null。
function readLibraryPdf(c: Container, paperKey: string): Uint8Array | null {
  const file = c.library.getPdfFile(paperKey)
  if (!file) return null
  try {
    return new Uint8Array(fs.readFileSync(join(c.libraryDir, file)))
  } catch {
    return null // 文件被手动删除等 — 视作无 PDF
  }
}

// 论文全文（含 sqlite 缓存）——paper:text 与 paper:deepread 共用。
// 缓存键 = paper.key（旧库迁移来的附件 key 行查不中 → 重抽一次,无损）。
async function getPaperTextCached(c: Container, paper: Paper): Promise<string> {
  const cached = c.db.prepare('SELECT text FROM pdf_cache WHERE attachment_key = ?').get(paper.key) as { text: string } | undefined
  if (cached) return cached.text
  const bytes = readLibraryPdf(c, paper.key)
  if (!bytes) return ''
  const text = await extractPdfText(bytes)
  if (text) {
    c.db.prepare('INSERT OR REPLACE INTO pdf_cache (attachment_key, text, cached_at) VALUES (?, ?, ?)')
      .run(paper.key, text, Date.now())
  }
  return text
}

// 对话引用定位专用：带 [第N页] 标记的正文。会话内存缓存（按论文 key），重启重抽取。
const pagedTextCache = new Map<string, string>()
async function getPaperTextPaged(c: Container, paper: Paper): Promise<string> {
  const hit = pagedTextCache.get(paper.key)
  if (hit !== undefined) return hit
  const bytes = readLibraryPdf(c, paper.key)
  if (!bytes) return ''
  const text = await extractPdfText(bytes, { pageMarkers: true })
  pagedTextCache.set(paper.key, text)
  return text
}

// AI 生成 2-4 个标签；任何失败回退空数组，绝不阻塞保存
async function generateTags(c: Container, content: string): Promise<string[]> {
  try {
    return parseTags(await c.ai().complete(buildTagMessages(content)))
  } catch {
    return []
  }
}

export function registerIpc(c: Container) {
  ipcMain.handle('config:get', () => c.configStore.get())
  ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => c.configStore.set(patch))

  // 通道名保留(渲染层零改动),数据源已换为本地文献库
  ipcMain.handle('zotero:list', (_e, collectionKey: string | null) => c.library.listPapers(collectionKey))
  ipcMain.handle('zotero:collections', () => c.library.listFolders())

  // 返回论文全文（带 sqlite 缓存）
  ipcMain.handle('paper:text', (_e, paper: Paper): Promise<string> => getPaperTextCached(c, paper))

  // 对话引用定位：带 [第N页] 标记的正文（内存缓存，不入 pdf_cache）
  ipcMain.handle('paper:textPaged', (_e, paper: Paper): Promise<string> => getPaperTextPaged(c, paper))

  // 返回论文 PDF 原始字节（不缓存——按需获取用于前端渲染）
  ipcMain.handle('paper:pdfBytes', async (_e, paper: Paper): Promise<ArrayBuffer | null> => {
    const bytes = readLibraryPdf(c, paper.key)
    return bytes ? toArrayBuffer(bytes) : null
  })

  ipcMain.handle('chat:send', async (_e, args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string }) => {
    const { messages } = buildMessages({ paper: args.paper, paperText: args.paperText, history: args.history, userInput: args.input })
    return c.ai().complete(messages)
  })

  ipcMain.handle('chat:stream', async (event, args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string; deepThink?: boolean }) => {
    const { messages, truncated, usedChars, totalChars } = buildMessages({ paper: args.paper, paperText: args.paperText, history: args.history, userInput: args.input })
    currentAbort = new AbortController()
    try {
      const text = await c.ai({ deepThink: args.deepThink })
        .stream(messages, (delta, kind) => event.sender.send('chat:token', delta, kind), currentAbort.signal)
      return { text, truncated, usedChars, totalChars }
    } finally {
      currentAbort = null
    }
  })

  ipcMain.handle('chat:stop', () => { currentAbort?.abort() })

  ipcMain.handle('chat:history', (_e, paperKey: string) => c.chatRepo.listByPaper(paperKey))
  ipcMain.handle('chat:append', (_e, m: { paperKey: string; role: 'user' | 'assistant'; content: string; reasoning?: string | null }) => c.chatRepo.append(m))
  ipcMain.handle('chat:clear', (_e, paperKey: string) => c.chatRepo.clearByPaper(paperKey))
  ipcMain.handle('chat:replace', (_e, a: { paperKey: string; messages: Array<{ role: 'user' | 'assistant'; content: string; reasoning?: string | null }> }) => c.chatRepo.replaceAll(a.paperKey, a.messages))

  ipcMain.handle('chat:followups', async (_e, a: { paperTitle: string; lastAnswer: string }) => {
    try {
      return parseFollowups(await c.ai().complete(buildFollowupMessages(a.paperTitle, a.lastAnswer)))
    } catch {
      return []
    }
  })

  ipcMain.handle('notes:add', async (_e, n: { paperKey: string; content: string; tags: string[]; autoTag?: boolean }) => {
    const tags = n.autoTag && n.tags.length === 0 ? await generateTags(c, n.content) : n.tags
    return c.notesRepo.add({ paperKey: n.paperKey, content: n.content, tags })
  })
  ipcMain.handle('notes:list', (_e, paperKey: string) => c.notesRepo.listByPaper(paperKey))

  ipcMain.handle('notes:sync', async (_e, args: { noteId: string; paper: Paper }) => {
    const note = c.notesRepo.listByPaper(args.paper.key).find(n => n.id === args.noteId)
    if (!note) throw new Error('note not found')
    const pageId = await c.notion().sync(note, args.paper)
    c.notesRepo.markSynced(note.id, pageId)
    return pageId
  })

  ipcMain.handle('notes:listAll', () => c.notesRepo.listAll())

  ipcMain.handle('notes:delete', (_e, id: string) => c.notesRepo.remove(id))

  // —— PDF 高亮标注 ——
  ipcMain.handle('highlights:list', (_e, paperKey: string) => c.highlightsRepo.listByPaper(paperKey))
  ipcMain.handle('highlights:add', (_e, h: { paperKey: string; pageIndex: number; rects: number[][]; text: string; color: string; comment?: string | null }) =>
    c.highlightsRepo.add(h))
  ipcMain.handle('highlights:update', (_e, a: { id: string; comment?: string | null; color?: string }) => {
    c.highlightsRepo.update(a.id, { comment: a.comment, color: a.color })
  })
  ipcMain.handle('highlights:delete', (_e, id: string) => c.highlightsRepo.remove(id))

  // 把某论文未同步的高亮推送到 Zotero（单向）。需要写权限的 API key。
  ipcMain.handle('highlights:sync', async (_e, paperKey: string) => {
    if (syncingPapers.has(paperKey)) return { synced: 0, failed: 0 } // 已有同步在途，忽略重复请求
    const pending = c.highlightsRepo.listUnsynced(paperKey)
    if (pending.length === 0) return { synced: 0, failed: 0 }
    syncingPapers.add(paperKey)
    try {
      const attachmentKey = await c.zotero().findPdfAttachment(paperKey)
      if (!attachmentKey) throw new Error('该论文在 Zotero 中没有 PDF 附件，无法同步标注')
      let synced = 0, failed = 0
      let lastError = ''
      for (const hl of pending) {
        try {
          const item = buildAnnotationPayload(hl, attachmentKey, SORT_REF_TOP_PT)
          const key = await c.zotero().createAnnotation(item)
          c.highlightsRepo.markSynced(hl.id, key)
          synced++
        } catch (e) {
          failed++
          lastError = e instanceof Error ? e.message : String(e)
        }
      }
      if (synced === 0 && failed > 0) throw new Error(lastError || '同步失败')
      return { synced, failed }
    } finally {
      syncingPapers.delete(paperKey)
    }
  })

  ipcMain.handle('kb:status', async () => {
    const total = c.library.listPapers().length
    return { ...kbStatus(c.db), totalPapers: total, embeddedChunks: embeddingStats(c.db).embedded }
  })

  // 全库索引：逐篇本地抽取 → 切块入库；kb:progress 推进度；单篇失败跳过
  ipcMain.handle('kb:index', async (event) => {
    const papers = c.library.listPapers()
    const done = indexedPaperKeys(c.db)
    let indexed = 0, skipped = 0, processed = 0
    for (const p of papers) {
      processed++
      if (done.has(p.key)) { event.sender.send('kb:progress', processed, papers.length, p.title); continue }
      try {
        const text = await getPaperTextPaged(c, p)
        if (text) { insertChunks(c.db, p.key, p.title, chunkPagedText(text)); indexed++ }
        else skipped++
      } catch { skipped++ }
      event.sender.send('kb:progress', processed, papers.length, p.title)
    }
    // 嵌入回填：给未嵌入的 chunk（新建 + 历史）算语义向量。首次会下载模型(~30MB,走 hf-mirror)。
    // 模型下载/推理失败 → 跳过，不影响关键词检索。可在设置关闭语义检索。
    if (c.configStore.get().semanticSearch !== false) {
      const totalMissing = embeddingStats(c.db).total - embeddingStats(c.db).embedded
      let embedded = 0, fails = 0
      // 逐批容错：worker 主动回收/偶发崩溃时 embedPassages 会拒绝，下一轮取同批重试（自愈）；
      // 连续失败多次（如模型下载失败）才放弃，FTS5 仍可用。
      while (embeddingStats(c.db).embedded < embeddingStats(c.db).total) {
        const batch = chunksMissingEmbedding(c.db, 32)
        if (batch.length === 0) break
        try {
          const vecs = await c.embedder.embedPassages(batch.map(b => b.text))
          setChunkEmbeddings(c.db, batch.map((b, i) => ({ id: b.id, vec: vecs[i] })))
          embedded += batch.length
          fails = 0
          event.sender.send('kb:embed-progress', embedded, totalMissing)
        } catch {
          if (++fails > 5) break
        }
      }
    }
    return { indexed, skipped, ...kbStatus(c.db), embeddedChunks: embeddingStats(c.db).embedded }
  })

  ipcMain.handle('kb:ask', async (event, args: { question: string; history: ChatMessage[]; collectionKey?: string | null }) => {
    // 1) 查询扩写（带对话历史可解析「它」「这种方法」等指代）；失败回退原问题
    let terms: string[] = []
    try { terms = parseQueryTerms(await c.ai().complete(buildQueryExpansionMessages(args.question, args.history))) } catch { /* 扩写失败回退 */ }
    if (terms.length === 0) terms = [args.question]
    // 2) 召回：关键词(FTS5) + 语义(向量) 混合。限定文件夹时取更宽的池再过滤。
    const scoped = !!args.collectionKey
    const pool = scoped ? 80 : 24
    let hits = searchChunks(c.db, terms, pool)
    // 语义召回（可在设置关闭；模型未就绪/下载失败/worker 卡死则静默回退到仅关键词）
    if (c.configStore.get().semanticSearch !== false) {
      try {
        // 给用户侧问答一个短超时：模型还在后台下载/嵌入时不让这次提问久等，直接回退关键词
        const qvec = await Promise.race([
          c.embedder.embedQuery(args.question),
          new Promise<Float32Array>((_, rej) => setTimeout(() => rej(new Error('embed timeout')), 20_000)),
        ])
        const vhits = searchVector(c.db, qvec, pool)
        const seen = new Set(hits.map(h => h.id))
        for (const v of vhits) if (!seen.has(v.id)) { hits.push(v); seen.add(v.id) }
      } catch { /* 语义检索不可用 → 仅关键词 */ }
    }
    if (scoped) {
      const allowed = new Set(c.library.listPapers(args.collectionKey).map(p => p.key))
      hits = hits.filter(h => allowed.has(h.paperKey))
    }
    // 3) 无命中：优雅返回，不抛错
    if (hits.length === 0) {
      return {
        answer: scoped
          ? '该文件夹范围内没有检索到相关内容。可换个问法、改为「全部」范围，或到「索引状态」更新索引后再试。'
          : '知识库中没有检索到与这个问题相关的内容。可以换个问法，或到「索引状态」里更新索引后再试。',
        sources: [], followups: [],
      }
    }
    // 4) 命中多时 LLM rerank：按分数降序稳定排序（同分保持检索原序）；失败直接取前 8
    if (hits.length > 8) {
      try {
        const scores = parseRerankScores(await c.ai().complete(buildRerankMessages(args.question, hits)), hits.length)
        if (scores) {
          hits = hits
            .map((h, i) => ({ h, i, s: scores[i] }))
            .sort((a, b) => b.s - a.s || a.i - b.i)
            .map(x => x.h)
        }
      } catch { /* rerank 失败 → 保持 bm25 排序 */ }
    }
    // 5) 按论文聚合来源（chips 顺序即 [来源N] 编号，含 chunks 原文供前端展示）
    const sources = groupHitsToSources(hits.slice(0, 8))
    const answer = await c.ai().stream(
      buildKbAnswerMessages(args.question, sources, args.history),
      (delta, kind) => event.sender.send('kb:token', delta, kind))
    // 追问建议：失败不影响主回答
    let followups: string[] = []
    try { followups = parseFollowups(await c.ai().complete(buildKbFollowupMessages(answer))) } catch { /* 忽略 */ }
    return { answer, sources, followups }
  })

  // 一键结构化精读：流式生成 → 自动打标签 → 直接存为笔记
  ipcMain.handle('paper:deepread', async (event, paper: Paper) => {
    const paperText = await getPaperTextCached(c, paper)
    const messages = buildDeepReadMessages(
      paper, paperText || '（未能获取论文正文。请仅基于元数据撰写，并在开头明确说明缺乏正文。）')
    const content = await c.ai().stream(messages, (delta, kind) => event.sender.send('deepread:token', delta, kind))
    if (!content) throw new Error('精读生成失败：AI 未返回内容')
    const tags = await generateTags(c, content)
    return c.notesRepo.add({ paperKey: paper.key, content, tags })
  })

  // 自动综述：map（逐篇要点提炼）+ reduce（汇总综述，流式）
  ipcMain.handle('kb:review', async (event, args: { collectionKey: string | null; scopeLabel: string }) => {
    const papers = c.library.listPapers(args.collectionKey)
    const indexed = indexedPaperKeys(c.db)
    const scoped = papers.filter(p => indexed.has(p.key))
    if (scoped.length === 0) return { content: '该范围内没有已索引的论文，请先到「索引状态」更新索引。', papers: 0, skipped: papers.length }
    const items: Array<{ title: string; points: string }> = []
    let done = 0, skipped = papers.length - scoped.length
    for (const p of scoped) {
      try {
        const points = await c.ai().complete(buildReviewMapMessages(p.title, representativeChunks(c.db, p.key)))
        items.push({ title: p.title, points })
      } catch { skipped++ }
      done++
      event.sender.send('kb:review-progress', done, scoped.length, p.title)
    }
    if (items.length === 0) throw new Error('综述失败：所有论文要点提炼均失败')
    const content = await c.ai().stream(
      buildReviewReduceMessages(args.scopeLabel, items),
      (delta, kind) => event.sender.send('kb:review-token', delta, kind),
    )
    return { content, papers: items.length, skipped }
  })

  // —— 入库(L2)：DOI/arXiv 引用入库、拖 PDF 入库、手动元数据 ——
  const genPaperKey = (): string => {
    for (;;) {
      const key = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
      if (!c.db.prepare('SELECT 1 FROM lib_papers WHERE key = ?').get(key)) return key
    }
  }
  const paperByKey = (key: string): Paper => {
    const p = c.library.listPapers().find(x => x.key === key)
    if (!p) throw new Error('论文入库后读取失败')
    return p
  }

  // 粘贴 DOI/arXiv 号(或链接)→ 拉元数据入库;arXiv 顺带自动下载 PDF(失败不阻塞,pdf:false)
  ipcMain.handle('paper:addByRef', async (_e, input: string) => {
    const ref = parseRefInput(input)
    if (ref.kind === 'unknown') throw new Error('无法识别输入。请粘贴 DOI(10.xxxx/…)或 arXiv 编号(如 2405.12345)/链接')
    const meta = ref.kind === 'arxiv' ? await fetchArxivMeta(ref.id, fetch) : await fetchCrossrefMeta(ref.doi, fetch)
    const key = genPaperKey()
    c.library.upsertPaper({
      key, title: meta.title, authors: meta.authors, year: meta.year, abstract: meta.abstract,
      doi: meta.doi, arxivId: meta.arxivId,
    })
    let pdf = false
    if (meta.pdfUrl) {
      try {
        const res = await fetch(meta.pdfUrl)
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer())
          if (bytes.length > 1000) {
            fs.writeFileSync(join(c.libraryDir, `${key}.pdf`), bytes)
            c.library.setPaperPdf(key, `${key}.pdf`)
            pdf = true
          }
        }
      } catch { /* PDF 下载失败 → 条目保留,可稍后拖 PDF 补 */ }
    }
    return { paper: paperByKey(key), pdf }
  })

  // 拖入 PDF 前的标题猜测:首页文本首行
  ipcMain.handle('paper:sniffPdf', async (_e, bytes: ArrayBuffer) => {
    try {
      const text = await extractPdfText(new Uint8Array(bytes), { maxChars: 600 })
      const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 3) ?? ''
      return { titleGuess: firstLine.slice(0, 120) }
    } catch {
      return { titleGuess: '' }
    }
  })

  // 手动元数据入库(拉取失败兜底 / 拖 PDF 的确认框)
  ipcMain.handle('paper:addManual', async (_e, m: { title: string; authors: string[]; year: number | null; abstract: string; doi?: string | null }) => {
    if (!m.title.trim()) throw new Error('标题不能为空')
    const key = genPaperKey()
    c.library.upsertPaper({ key, title: m.title.trim(), authors: m.authors, year: m.year, abstract: m.abstract, doi: m.doi ?? null })
    return paperByKey(key)
  })

  // 给论文挂 PDF(拖入):写 library/<key>.pdf 并失效正文缓存
  ipcMain.handle('paper:attachPdf', async (_e, a: { paperKey: string; bytes: ArrayBuffer }) => {
    const bytes = new Uint8Array(a.bytes)
    if (bytes.length < 100) throw new Error('PDF 文件无效')
    const file = `${a.paperKey}.pdf`
    fs.writeFileSync(join(c.libraryDir, file), bytes)
    c.library.setPaperPdf(a.paperKey, file)
    c.db.prepare('DELETE FROM pdf_cache WHERE attachment_key = ?').run(a.paperKey)
    pagedTextCache.delete(a.paperKey)
  })

  // —— 文献库信息(L4)：设置页展示数据目录 + 一键在访达打开(便于手动备份) ——
  ipcMain.handle('library:info', () => ({ dataDir: app.getPath('userData'), papers: c.library.countPapers() }))
  ipcMain.handle('library:openDir', () => shell.openPath(app.getPath('userData')))

  // —— 管理(L3)：文件夹 CRUD、论文编辑/归属/级联删除 ——
  ipcMain.handle('folder:add', (_e, f: { name: string; parentId?: string | null }) => {
    if (!f.name.trim()) throw new Error('文件夹名不能为空')
    return c.library.addFolder({ name: f.name.trim(), parentId: f.parentId ?? null })
  })
  ipcMain.handle('folder:rename', (_e, a: { id: string; name: string }) => {
    if (!a.name.trim()) throw new Error('文件夹名不能为空')
    c.library.renameFolder(a.id, a.name.trim())
  })
  ipcMain.handle('folder:delete', (_e, id: string) => c.library.deleteFolder(id))

  ipcMain.handle('paper:update', (_e, a: { key: string; title: string; authors: string[]; year: number | null; abstract: string; doi?: string | null }) => {
    if (!a.title.trim()) throw new Error('标题不能为空')
    c.library.updatePaper(a.key, { title: a.title.trim(), authors: a.authors, year: a.year, abstract: a.abstract, doi: a.doi ?? null })
  })
  ipcMain.handle('paper:folders', (_e, paperKey: string) => c.library.getPaperFolders(paperKey))
  ipcMain.handle('paper:setFolders', (_e, a: { paperKey: string; folderIds: string[] }) =>
    c.library.setPaperFolders(a.paperKey, a.folderIds))

  // 删除论文：级联清笔记/高亮/对话/索引块(FTS 触发器同步)/正文缓存/归属 + PDF 文件
  ipcMain.handle('paper:delete', (_e, paperKey: string) => {
    const pdfFile = c.library.getPdfFile(paperKey)
    const cascade = c.db.transaction((key: string) => {
      c.db.prepare('DELETE FROM notes WHERE paper_key = ?').run(key)
      c.db.prepare('DELETE FROM highlights WHERE paper_key = ?').run(key)
      c.db.prepare('DELETE FROM chat_messages WHERE paper_key = ?').run(key)
      c.db.prepare('DELETE FROM chunks WHERE paper_key = ?').run(key)
      c.db.prepare('DELETE FROM pdf_cache WHERE attachment_key = ?').run(key)
    })
    cascade(paperKey)
    c.library.deletePaper(paperKey)
    pagedTextCache.delete(paperKey)
    if (pdfFile) { try { fs.unlinkSync(join(c.libraryDir, pdfFile)) } catch { /* 文件已不存在 */ } }
  })

  // —— 一次性迁移(L1)：① 旧 PaperLens 整库搬迁 ② Zotero 文献导入 ——
  let migrating = false
  ipcMain.handle('migrate:status', () => {
    const oldDb = join(app.getPath('appData'), 'paperlens', 'paperlens.db')
    const cfg = c.configStore.get()
    return {
      hasPaperLens: fs.existsSync(oldDb),
      zoteroConfigured: Boolean(cfg.zoteroApiKey && cfg.zoteroUserId),
      paperCount: c.library.countPapers(),
    }
  })

  ipcMain.handle('migrate:run', async (event) => {
    if (migrating) throw new Error('迁移已在进行中')
    migrating = true
    try {
      const oldDir = join(app.getPath('appData'), 'paperlens')
      const oldDb = join(oldDir, 'paperlens.db')
      let fromPaperLens = false
      // ① 整库搬迁：仅当目标库还没有笔记与索引(全新库)且旧库存在——避免对已用库做合并语义
      const notesN = (c.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n
      const chunksN = (c.db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n
      if (fs.existsSync(oldDb) && notesN === 0 && chunksN === 0) {
        event.sender.send('migrate:progress', 'paperlens', 0, 1, '搬迁 PaperLens 笔记/高亮/对话/索引…')
        importFromPaperLens(c.db, oldDb)
        copyModelsDir(join(oldDir, 'models'), join(app.getPath('userData'), 'models'))
        fromPaperLens = true
        event.sender.send('migrate:progress', 'paperlens', 1, 1, 'PaperLens 数据搬迁完成')
      }
      // ② Zotero 文献导入(需先在设置里配好 Zotero;未配则跳过)
      let z = { papers: 0, folders: 0, pdfs: 0, pdfMissing: 0 }
      const cfg = c.configStore.get()
      if (cfg.zoteroApiKey && cfg.zoteroUserId) {
        z = await importFromZotero({
          repo: c.library,
          zotero: c.zotero(),
          zoteroLocal: c.zoteroLocal(),
          writePdf: (key, bytes) => {
            const f = `${key}.pdf`
            fs.writeFileSync(join(c.libraryDir, f), bytes)
            return f
          },
          onProgress: (done, total, title) => event.sender.send('migrate:progress', 'zotero', done, total, title),
        })
      }
      return { fromPaperLens, zoteroConfigured: Boolean(cfg.zoteroApiKey && cfg.zoteroUserId), ...z }
    } finally {
      migrating = false
    }
  })
}
