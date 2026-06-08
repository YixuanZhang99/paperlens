import type DatabaseType from 'better-sqlite3'

export function migrate(db: DatabaseType.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      paper_key TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      notion_page_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notes_paper ON notes(paper_key);

    CREATE TABLE IF NOT EXISTS pdf_cache (
      attachment_key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );
  `)
}
