import type DatabaseType from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Paper, ZoteroCollection } from '@shared/types'

// PaperDesk 自建文献库(L1)：lib_* 三表的读写仓库。
// 读接口的返回形状与原 zotero-client 完全一致(Paper / ZoteroCollection),
// 让 IPC 换源后渲染层零改动;attachmentKey 在本地库语义下恒为 null。

export interface UpsertPaperInput {
  key: string
  title: string
  authors: string[]
  year: number | null
  abstract: string
  doi?: string | null
  arxivId?: string | null
  pdfPath?: string | null
  createdAt?: number
}

export function createLibraryRepo(deps: { db: DatabaseType.Database }) {
  const { db } = deps

  const rowToPaper = (r: { key: string; title: string; authors: string; year: number | null; abstract: string }): Paper => ({
    key: r.key,
    title: r.title,
    authors: JSON.parse(r.authors) as string[],
    year: r.year,
    abstract: r.abstract,
    attachmentKey: null,
  })

  const upsertPaperStmt = db.prepare(`
    INSERT INTO lib_papers (key, title, authors, year, abstract, doi, arxiv_id, pdf_path, created_at)
    VALUES (@key, @title, @authors, @year, @abstract, @doi, @arxivId, @pdfPath, @createdAt)
    ON CONFLICT(key) DO UPDATE SET
      title = excluded.title, authors = excluded.authors, year = excluded.year,
      abstract = excluded.abstract, doi = excluded.doi, arxiv_id = excluded.arxiv_id
  `)

  function upsertPaper(p: UpsertPaperInput): void {
    upsertPaperStmt.run({
      key: p.key, title: p.title, authors: JSON.stringify(p.authors), year: p.year ?? null,
      abstract: p.abstract, doi: p.doi ?? null, arxivId: p.arxivId ?? null,
      pdfPath: p.pdfPath ?? null, createdAt: p.createdAt ?? Date.now(),
    })
  }

  function listPapers(folderId?: string | null): Paper[] {
    const rows = (folderId
      ? db.prepare(`
          SELECT p.key, p.title, p.authors, p.year, p.abstract FROM lib_papers p
          JOIN lib_paper_folders pf ON pf.paper_key = p.key
          WHERE pf.folder_id = ? ORDER BY p.created_at DESC`).all(folderId)
      : db.prepare(`SELECT key, title, authors, year, abstract FROM lib_papers ORDER BY created_at DESC`).all()
    ) as Array<{ key: string; title: string; authors: string; year: number | null; abstract: string }>
    return rows.map(rowToPaper)
  }

  function listFolders(): ZoteroCollection[] {
    const rows = db.prepare(`SELECT id, name, parent_id FROM lib_folders ORDER BY sort ASC, name ASC`)
      .all() as Array<{ id: string; name: string; parent_id: string | null }>
    return rows.map(r => ({ key: r.id, name: r.name, parentKey: r.parent_id }))
  }

  function upsertFolder(f: { id: string; name: string; parentId?: string | null; sort?: number }): void {
    db.prepare(`
      INSERT INTO lib_folders (id, name, parent_id, sort) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, sort = excluded.sort
    `).run(f.id, f.name, f.parentId ?? null, f.sort ?? 0)
  }

  const setFoldersTx = db.transaction((paperKey: string, folderIds: string[]) => {
    db.prepare('DELETE FROM lib_paper_folders WHERE paper_key = ?').run(paperKey)
    const ins = db.prepare('INSERT OR IGNORE INTO lib_paper_folders (paper_key, folder_id) VALUES (?, ?)')
    for (const fid of folderIds) ins.run(paperKey, fid)
  })

  function setPaperFolders(paperKey: string, folderIds: string[]): void {
    setFoldersTx(paperKey, folderIds)
  }

  function setPaperPdf(key: string, pdfPath: string): void {
    db.prepare('UPDATE lib_papers SET pdf_path = ? WHERE key = ?').run(pdfPath, key)
  }

  function getPdfFile(paperKey: string): string | null {
    const r = db.prepare('SELECT pdf_path FROM lib_papers WHERE key = ?').get(paperKey) as { pdf_path: string | null } | undefined
    return r?.pdf_path ?? null
  }

  function getPaperByKey(key: string): Paper | null {
    const r = db.prepare('SELECT key, title, authors, year, abstract FROM lib_papers WHERE key = ?')
      .get(key) as { key: string; title: string; authors: string; year: number | null; abstract: string } | undefined
    return r ? rowToPaper(r) : null
  }

  function countPapers(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM lib_papers').get() as { n: number }).n
  }

  // —— 管理(L3) ——

  function updatePaper(key: string, m: { title: string; authors: string[]; year: number | null; abstract: string; doi?: string | null }): void {
    db.prepare('UPDATE lib_papers SET title = ?, authors = ?, year = ?, abstract = ?, doi = ? WHERE key = ?')
      .run(m.title, JSON.stringify(m.authors), m.year ?? null, m.abstract, m.doi ?? null, key)
    // 级联同步知识库块的冗余标题,否则改名后 KB 来源 chip 一直显示旧标题
    db.prepare('UPDATE chunks SET paper_title = ? WHERE paper_key = ?').run(m.title, key)
  }

  const deletePaperTx = db.transaction((key: string) => {
    db.prepare('DELETE FROM lib_paper_folders WHERE paper_key = ?').run(key)
    db.prepare('DELETE FROM lib_papers WHERE key = ?').run(key)
  })
  function deletePaper(key: string): void {
    deletePaperTx(key)
  }

  function getPaperFolders(paperKey: string): string[] {
    return (db.prepare('SELECT folder_id FROM lib_paper_folders WHERE paper_key = ?').all(paperKey) as Array<{ folder_id: string }>)
      .map(r => r.folder_id)
  }

  const genFolderId = (): string => {
    for (;;) {
      const id = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
      if (!db.prepare('SELECT 1 FROM lib_folders WHERE id = ?').get(id)) return id
    }
  }

  function addFolder(f: { name: string; parentId?: string | null }): ZoteroCollection {
    const id = genFolderId()
    upsertFolder({ id, name: f.name, parentId: f.parentId ?? null })
    return { key: id, name: f.name, parentKey: f.parentId ?? null }
  }

  function renameFolder(id: string, name: string): void {
    db.prepare('UPDATE lib_folders SET name = ? WHERE id = ?').run(name, id)
  }

  // 删除文件夹：子文件夹上提一级(parent 置为被删者的 parent)；论文只解除归属
  const deleteFolderTx = db.transaction((id: string) => {
    const row = db.prepare('SELECT parent_id FROM lib_folders WHERE id = ?').get(id) as { parent_id: string | null } | undefined
    if (!row) return
    db.prepare('UPDATE lib_folders SET parent_id = ? WHERE parent_id = ?').run(row.parent_id, id)
    db.prepare('DELETE FROM lib_paper_folders WHERE folder_id = ?').run(id)
    db.prepare('DELETE FROM lib_folders WHERE id = ?').run(id)
  })
  function deleteFolder(id: string): void {
    deleteFolderTx(id)
  }

  return {
    listPapers, listFolders, upsertPaper, upsertFolder, setPaperFolders, setPaperPdf, getPdfFile, getPaperByKey, countPapers,
    updatePaper, deletePaper, getPaperFolders, addFolder, renameFolder, deleteFolder,
  }
}

export type LibraryRepo = ReturnType<typeof createLibraryRepo>
