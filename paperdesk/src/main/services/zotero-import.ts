import type { Paper, ZoteroCollection } from '@shared/types'
import type { LibraryRepo } from './library-repo'

// 一次性迁移:Zotero → PaperDesk 本地文献库。
// 元数据/文件夹树(含多归属)沿用 Zotero item/collection key;PDF 优先本地 storage 读取,
// 缺失走 Web API 下载,都失败计 pdfMissing(条目保留可后补)。upsert 天然幂等。
export interface ZoteroImportDeps {
  repo: LibraryRepo
  zotero: {
    listPapers(collectionKey?: string | null): Promise<Paper[]>
    listCollections(): Promise<ZoteroCollection[]>
    findPdfAttachmentInfo(paperKey: string): Promise<{ key: string; filename: string } | null>
    downloadAttachment(attachmentKey: string): Promise<ArrayBuffer>
  }
  zoteroLocal: { readPdf(attachmentKey: string, filename?: string | null): Uint8Array | null }
  writePdf(paperKey: string, bytes: Uint8Array): string // 写 library/<key>.pdf,返回文件名
  onProgress?: (done: number, total: number, title: string) => void
}

export async function importFromZotero(
  deps: ZoteroImportDeps,
): Promise<{ papers: number; folders: number; pdfs: number; pdfMissing: number }> {
  // 重复导入语义:已存在的论文/文件夹完全跳过(保护用户在 PaperDesk 里的编辑与归属调整),
  // 只增量导入新条目;PDF 仅对「库里还没有 PDF」的论文补齐。
  const existingPapers = new Set(deps.repo.listPapers().map(p => p.key))
  const existingFolders = new Set(deps.repo.listFolders().map(f => f.key))

  // 1) 文件夹树(仅新增)
  const cols = await deps.zotero.listCollections()
  const newCols = cols.filter(c => !existingFolders.has(c.key))
  for (const c of newCols) deps.repo.upsertFolder({ id: c.key, name: c.name, parentId: c.parentKey })

  // 2) 论文(key 沿用,仅新增)
  const papers = await deps.zotero.listPapers()
  const newPapers = papers.filter(p => !existingPapers.has(p.key))
  const now = Date.now()
  newPapers.forEach((p, i) => deps.repo.upsertPaper({
    key: p.key, title: p.title, authors: p.authors, year: p.year, abstract: p.abstract,
    // 递减毫秒保持 Zotero 返回顺序(其序≈最近修改优先)在 created_at DESC 下稳定
    createdAt: now - i,
  }))

  // 3) 归属:逐 collection 查成员,聚合 paper → folderIds(多对多;仅新论文,不动已有论文的归属)
  const newKeys = new Set(newPapers.map(p => p.key))
  const memberships = new Map<string, string[]>()
  for (const c of cols) {
    for (const p of await deps.zotero.listPapers(c.key)) {
      if (!newKeys.has(p.key)) continue
      const list = memberships.get(p.key) ?? []
      list.push(c.key)
      memberships.set(p.key, list)
    }
  }
  for (const [paperKey, folderIds] of memberships) deps.repo.setPaperFolders(paperKey, folderIds)

  // 4) PDF:仅对库里尚无 PDF 的论文尝试(local → web → missing)
  let pdfs = 0, pdfMissing = 0, done = 0
  for (const p of papers) {
    try {
      if (deps.repo.getPdfFile(p.key)) continue // 已有 PDF,不动
      const info = await deps.zotero.findPdfAttachmentInfo(p.key)
      if (!info) { pdfMissing++; continue }
      let bytes: Uint8Array | null = null
      try { bytes = deps.zoteroLocal.readPdf(info.key, info.filename) } catch { bytes = null }
      if (!bytes) {
        try { bytes = new Uint8Array(await deps.zotero.downloadAttachment(info.key)) } catch { bytes = null }
      }
      if (bytes && bytes.length > 0) {
        deps.repo.setPaperPdf(p.key, deps.writePdf(p.key, bytes))
        pdfs++
      } else pdfMissing++
    } catch { pdfMissing++ }
    finally {
      done++
      deps.onProgress?.(done, papers.length, p.title)
    }
  }

  return { papers: newPapers.length, folders: newCols.length, pdfs, pdfMissing }
}
