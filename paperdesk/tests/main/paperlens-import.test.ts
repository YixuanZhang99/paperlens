import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { importFromPaperLens } from '../../src/main/services/paperlens-import'
import { searchChunks } from '../../src/main/services/kb'

// 源库必须是磁盘文件(ATTACH 需要路径);目标库用内存即可。
function makeSrcDb(dir: string): string {
  const p = join(dir, 'src-paperlens.db')
  const src = new Database(p)
  migrate(src)
  src.prepare(`INSERT INTO notes (id, paper_key, content, tags, created_at, notion_page_id) VALUES ('n1','P1','笔记内容','["tag"]',1,NULL)`).run()
  src.prepare(`INSERT INTO highlights (id, paper_key, page_index, rects, text, color, comment, zotero_key, created_at)
               VALUES ('h1','P1',3,'[[1,2,3,4]]','高亮文本','#ffeb3b',NULL,NULL,2)`).run()
  src.prepare(`INSERT INTO chat_messages (paper_key, role, content, reasoning, created_at) VALUES ('P1','user','问题',NULL,3)`).run()
  const emb = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer)
  src.prepare(`INSERT INTO chunks (paper_key, paper_title, seq, text, page_index, embedding)
               VALUES ('P1','论文一',0,'RLHF 对齐训练相关内容',5,?)`).run(emb)
  src.prepare(`INSERT INTO pdf_cache (attachment_key, text, cached_at) VALUES ('ATT1','缓存正文',4)`).run()
  src.close()
  return p
}

describe('importFromPaperLens', () => {
  it('copies all five tables incl. embedding BLOB and page_index; FTS works; idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-import-'))
    try {
      const srcPath = makeSrcDb(dir)
      const dest = new Database(':memory:')
      migrate(dest)

      const r1 = importFromPaperLens(dest, srcPath)
      expect(r1).toEqual({ notes: 1, highlights: 1, chats: 1, chunks: 1, pdfCache: 1 })

      // 数据完整性
      expect((dest.prepare('SELECT content FROM notes WHERE id=?').get('n1') as { content: string }).content).toBe('笔记内容')
      const chunk = dest.prepare('SELECT page_index, embedding FROM chunks WHERE paper_key=?').get('P1') as { page_index: number; embedding: Buffer }
      expect(chunk.page_index).toBe(5)
      expect(Array.from(new Float32Array(chunk.embedding.buffer.slice(chunk.embedding.byteOffset, chunk.embedding.byteOffset + chunk.embedding.byteLength))))
        .toEqual([expect.closeTo(0.1, 5), expect.closeTo(0.2, 5), expect.closeTo(0.3, 5)])
      // FTS 触发器随 INSERT 建好 → 可检索
      expect(searchChunks(dest, ['RLHF']).length).toBe(1)

      // 幂等:重复导入不翻倍
      const r2 = importFromPaperLens(dest, srcPath)
      expect(r2.notes).toBe(0)
      expect((dest.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
