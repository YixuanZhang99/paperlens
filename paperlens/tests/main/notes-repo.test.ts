import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { createNotesRepo } from '../../src/main/services/notes-repo'

function repo() {
  const db = new Database(':memory:')
  migrate(db)
  let seq = 0
  return createNotesRepo({ db, now: () => 1700000000000, genId: () => `id-${++seq}` })
}

describe('NotesRepo', () => {
  it('saves and lists notes for a paper', () => {
    const r = repo()
    r.add({ paperKey: 'P1', content: '自注意力', tags: ['nlp'] })
    r.add({ paperKey: 'P1', content: '位置编码', tags: [] })
    r.add({ paperKey: 'P2', content: '无关', tags: [] })
    const list = r.listByPaper('P1')
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ paperKey: 'P1', content: '自注意力', tags: ['nlp'] })
    expect(list[0].id).toBe('id-1')
  })

  it('marks a note as synced with a notion page id', () => {
    const r = repo()
    const note = r.add({ paperKey: 'P1', content: 'x', tags: [] })
    r.markSynced(note.id, 'notion-123')
    const [reloaded] = r.listByPaper('P1')
    expect(reloaded.notionPageId).toBe('notion-123')
  })
})
