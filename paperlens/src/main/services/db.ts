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

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      paper_key TEXT NOT NULL,
      paper_title TEXT NOT NULL,
      seq INTEGER NOT NULL,
      text TEXT NOT NULL,
      page_index INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_paper ON chunks(paper_key);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text, content='chunks', content_rowid='id', tokenize='trigram'
    );
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
    END;

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY,
      paper_key TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_paper ON chat_messages(paper_key, id);

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      paper_key TEXT NOT NULL,
      page_index INTEGER NOT NULL,
      rects TEXT NOT NULL,
      text TEXT NOT NULL,
      color TEXT NOT NULL,
      comment TEXT,
      zotero_key TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_highlights_paper ON highlights(paper_key);
  `)

  // 旧库迁移：chunks 增加 page_index（来源跳页）。旧 chunk 无页码，清空让静默索引按页重建。
  const chunkCols = db.prepare(`PRAGMA table_info(chunks)`).all() as Array<{ name: string }>
  if (!chunkCols.some(c => c.name === 'page_index')) {
    db.exec(`ALTER TABLE chunks ADD COLUMN page_index INTEGER NOT NULL DEFAULT 0;`)
    db.exec(`DELETE FROM chunks;`)
  }
}
