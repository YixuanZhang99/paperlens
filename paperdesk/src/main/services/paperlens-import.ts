import type DatabaseType from 'better-sqlite3'
import fs from 'node:fs'

// 一次性迁移:把旧 PaperLens 的 paperlens.db 五表(笔记/高亮/对话/知识库块含向量/正文缓存)
// 经 ATTACH 整库拷入 PaperDesk。INSERT OR IGNORE 按主键幂等;chunks 显式列序防两库列序漂移;
// INSERT 触发 chunks_ai 触发器 → FTS 自动同步,无需重建。
export function importFromPaperLens(
  db: DatabaseType.Database,
  srcDbPath: string,
): { notes: number; highlights: number; chats: number; chunks: number; pdfCache: number } {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  const before = {
    notes: count('notes'), highlights: count('highlights'),
    chats: count('chat_messages'), chunks: count('chunks'), pdfCache: count('pdf_cache'),
  }

  db.exec(`ATTACH DATABASE '${srcDbPath.replaceAll("'", "''")}' AS src`)
  try {
    db.exec(`
      INSERT OR IGNORE INTO notes SELECT * FROM src.notes;
      INSERT OR IGNORE INTO highlights SELECT * FROM src.highlights;
      INSERT OR IGNORE INTO chat_messages SELECT * FROM src.chat_messages;
      INSERT OR IGNORE INTO chunks (id, paper_key, paper_title, seq, text, page_index, embedding)
        SELECT id, paper_key, paper_title, seq, text, page_index, embedding FROM src.chunks;
      INSERT OR IGNORE INTO pdf_cache SELECT * FROM src.pdf_cache;
    `)
  } finally {
    db.exec('DETACH DATABASE src')
  }

  return {
    notes: count('notes') - before.notes,
    highlights: count('highlights') - before.highlights,
    chats: count('chat_messages') - before.chats,
    chunks: count('chunks') - before.chunks,
    pdfCache: count('pdf_cache') - before.pdfCache,
  }
}

// 模型缓存目录拷贝(免重复下载 ~129MB);目标已存在的文件不覆盖。源不存在返回 false。
export function copyModelsDir(srcDir: string, destDir: string): boolean {
  if (!fs.existsSync(srcDir)) return false
  fs.cpSync(srcDir, destDir, { recursive: true, force: false, errorOnExist: false })
  return true
}
