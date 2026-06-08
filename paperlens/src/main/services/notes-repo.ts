import type DatabaseType from 'better-sqlite3'
import type { Note } from '@shared/types'

export interface NotesRepoDeps {
  db: DatabaseType.Database
  now: () => number
  genId: () => string
}

interface NoteRow {
  id: string; paper_key: string; content: string
  tags: string; created_at: number; notion_page_id: string | null
}

function rowToNote(r: NoteRow): Note {
  return {
    id: r.id, paperKey: r.paper_key, content: r.content,
    tags: JSON.parse(r.tags), createdAt: r.created_at, notionPageId: r.notion_page_id,
  }
}

export function createNotesRepo(deps: NotesRepoDeps) {
  const { db } = deps

  function add(input: { paperKey: string; content: string; tags: string[] }): Note {
    const note: Note = {
      id: deps.genId(), paperKey: input.paperKey, content: input.content,
      tags: input.tags, createdAt: deps.now(), notionPageId: null,
    }
    db.prepare(
      `INSERT INTO notes (id, paper_key, content, tags, created_at, notion_page_id)
       VALUES (@id, @paperKey, @content, @tags, @createdAt, @notionPageId)`
    ).run({ ...note, tags: JSON.stringify(note.tags) })
    return note
  }

  function listByPaper(paperKey: string): Note[] {
    const rows = db.prepare(
      'SELECT * FROM notes WHERE paper_key = ? ORDER BY created_at ASC'
    ).all(paperKey) as NoteRow[]
    return rows.map(rowToNote)
  }

  function markSynced(id: string, notionPageId: string): void {
    db.prepare('UPDATE notes SET notion_page_id = ? WHERE id = ?').run(notionPageId, id)
  }

  return { add, listByPaper, markSynced }
}
