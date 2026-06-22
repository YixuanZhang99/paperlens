import type DatabaseType from 'better-sqlite3'
import type { Highlight } from '@shared/types'

export interface HighlightsRepoDeps {
  db: DatabaseType.Database
  now: () => number
  genId: () => string
}

interface HighlightRow {
  id: string
  paper_key: string
  page_index: number
  rects: string
  text: string
  color: string
  comment: string | null
  zotero_key: string | null
  created_at: number
}

function rowToHighlight(r: HighlightRow): Highlight {
  return {
    id: r.id,
    paperKey: r.paper_key,
    pageIndex: r.page_index,
    rects: JSON.parse(r.rects),
    text: r.text,
    color: r.color,
    comment: r.comment,
    zoteroKey: r.zotero_key,
    createdAt: r.created_at,
  }
}

export function createHighlightsRepo(deps: HighlightsRepoDeps) {
  const { db } = deps

  function add(input: {
    paperKey: string
    pageIndex: number
    rects: number[][]
    text: string
    color: string
    comment?: string | null
  }): Highlight {
    const hl: Highlight = {
      id: deps.genId(),
      paperKey: input.paperKey,
      pageIndex: input.pageIndex,
      rects: input.rects,
      text: input.text,
      color: input.color,
      comment: input.comment ?? null,
      zoteroKey: null,
      createdAt: deps.now(),
    }
    db.prepare(
      `INSERT INTO highlights (id, paper_key, page_index, rects, text, color, comment, zotero_key, created_at)
       VALUES (@id, @paperKey, @pageIndex, @rects, @text, @color, @comment, @zoteroKey, @createdAt)`,
    ).run({ ...hl, rects: JSON.stringify(hl.rects) })
    return hl
  }

  function listByPaper(paperKey: string): Highlight[] {
    const rows = db
      .prepare('SELECT * FROM highlights WHERE paper_key = ? ORDER BY page_index ASC, created_at ASC')
      .all(paperKey) as HighlightRow[]
    return rows.map(rowToHighlight)
  }

  function listUnsynced(paperKey: string): Highlight[] {
    const rows = db
      .prepare('SELECT * FROM highlights WHERE paper_key = ? AND zotero_key IS NULL ORDER BY page_index ASC, created_at ASC')
      .all(paperKey) as HighlightRow[]
    return rows.map(rowToHighlight)
  }

  function get(id: string): Highlight | null {
    const row = db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as HighlightRow | undefined
    return row ? rowToHighlight(row) : null
  }

  /** 更新可编辑字段（注释 / 颜色）。只更新传入的字段。 */
  function update(id: string, patch: { comment?: string | null; color?: string }): void {
    if (patch.comment !== undefined) {
      db.prepare('UPDATE highlights SET comment = ? WHERE id = ?').run(patch.comment, id)
    }
    if (patch.color !== undefined) {
      db.prepare('UPDATE highlights SET color = ? WHERE id = ?').run(patch.color, id)
    }
  }

  function markSynced(id: string, zoteroKey: string): void {
    db.prepare('UPDATE highlights SET zotero_key = ? WHERE id = ?').run(zoteroKey, id)
  }

  function remove(id: string): void {
    db.prepare('DELETE FROM highlights WHERE id = ?').run(id)
  }

  return { add, listByPaper, listUnsynced, get, update, markSynced, remove }
}
