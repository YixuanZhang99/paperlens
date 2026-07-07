import type DatabaseType from 'better-sqlite3'
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

  function countPapers(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM lib_papers').get() as { n: number }).n
  }

  return { listPapers, listFolders, upsertPaper, upsertFolder, setPaperFolders, setPaperPdf, getPdfFile, countPapers }
}

export type LibraryRepo = ReturnType<typeof createLibraryRepo>
