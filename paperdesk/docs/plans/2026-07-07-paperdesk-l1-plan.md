# PaperDesk L1(数据层 + 双源迁移 + IPC 换源)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PaperDesk 的文献库自立——本地三表成为事实来源;一键把旧 PaperLens 数据整库搬入 + 从 Zotero 导入文献与 PDF;所有读路径换源,渲染层零改动。

**Architecture:** `library-repo`(SQLite 三表)替代 zotero-client 成为读源;`paperlens-import`(ATTACH 整库拷贝)+`zotero-import`(元数据/文件夹/PDF 拷贝)两个一次性迁移服务;IPC 通道名/返回形状不变。

**Tech Stack:** better-sqlite3(ATTACH DATABASE)、现有 zotero-client/zotero-local(仅迁移用)、Node fs。

## Global Constraints

- 不修改 `paperlens/` 下任何文件;PaperDesk 工作全部在 `paperdesk/`。
- IPC 通道名与返回形状不变(`zotero:list` 返回 Paper[]、`zotero:collections` 返回 ZoteroCollection[]);渲染层文献列表/树零改动(仅新增空态迁移 UI)。
- Paper.attachmentKey 在 lib 源恒为 null(已确认渲染层不使用)。
- 文件夹形状复用 ZoteroCollection:`{key: lib_folders.id, name, parentKey: parent_id}`。
- PDF 存 `userData/library/<paperKey>.pdf`;正文缓存键从附件 key 改为 paper key(旧缓存查不中则重抽,无损)。
- ABI 舞步与打包验证惯例同 L0 计划。

---

### Task 1: db.ts 三张表

**Files:** Modify `src/main/services/db.ts`;Test `tests/main/db-lib.test.ts`(新)

**Interfaces:** Produces 表 `lib_papers(key,title,authors,year,abstract,doi,arxiv_id,pdf_path,created_at)`、`lib_folders(id,name,parent_id,sort)`、`lib_paper_folders(paper_key,folder_id)`(PK 复合)。

- [ ] 测试:migrate 后三表存在、重复 migrate 幂等、lib_paper_folders 复合主键去重。
- [ ] 实现:migrate() 的 db.exec 块中追加三个 CREATE TABLE IF NOT EXISTS(DDL 见设计文档)+ `CREATE INDEX IF NOT EXISTS idx_lpf_folder ON lib_paper_folders(folder_id)`。
- [ ] vitest 该文件绿 → commit `feat(paperdesk): L1 文献库三表`。

### Task 2: library-repo

**Files:** Create `src/main/services/library-repo.ts`;Test `tests/main/library-repo.test.ts`

**Interfaces:** Produces
```ts
createLibraryRepo({ db }): {
  listPapers(folderId?: string | null): Paper[]        // null/省略=全部;按 created_at DESC
  listFolders(): ZoteroCollection[]                    // {key,name,parentKey}
  upsertPaper(p: { key; title; authors: string[]; year: number|null; abstract: string;
                   doi?: string|null; arxivId?: string|null; pdfPath?: string|null; createdAt?: number }): void
  setPaperPdf(key: string, pdfPath: string): void
  setPaperFolders(paperKey: string, folderIds: string[]): void   // 先删后插,同事务
  upsertFolder(f: { id; name; parentId?: string|null; sort?: number }): void
  getPdfFile(paperKey: string): string | null
  countPapers(): number
}
```
Paper 映射:authors JSON.parse、attachmentKey: null。

- [ ] 测试(内存 db+migrate):upsert 后 listPapers 形状/排序;folderId 过滤走 lib_paper_folders;listFolders 映射 parentKey;setPaperFolders 覆盖式;getPdfFile/countPapers;upsert 幂等更新 title。
- [ ] 实现 ≈90 行(prepare + 小事务)。
- [ ] 绿 → commit `feat(paperdesk): library-repo`。

### Task 3: paperlens-import(整库搬迁)

**Files:** Create `src/main/services/paperlens-import.ts`;Test `tests/main/paperlens-import.test.ts`

**Interfaces:** Produces
```ts
importFromPaperLens(db, srcDbPath: string): { notes; highlights; chats; chunks; pdfCache: number }
// 前置:调用方保证 srcDbPath 存在。幂等:全部 INSERT OR IGNORE(主键去重)。
copyModelsDir(srcDir: string, destDir: string, fs = nodeFs): boolean  // 存在则递归拷,force:false
```
核心实现:
```ts
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
} finally { db.exec('DETACH DATABASE src') }
```
(chunks 显式列序防两库列序漂移;INSERT 触发 chunks_ai 触发器自动建 FTS。)

- [ ] 测试:建两个内存库(migrate 后源库塞 notes/chunks 含 embedding BLOB/页码)→ 导入后行数/embedding 字节一致、FTS 可检索(searchChunks 命中)、重复导入不翻倍。
- [ ] 绿 → commit `feat(paperdesk): 旧 PaperLens 整库搬迁`。

### Task 4: zotero-import(文献+文件夹+PDF)

**Files:** Create `src/main/services/zotero-import.ts`;Test `tests/main/zotero-import.test.ts`

**Interfaces:** Produces
```ts
importFromZotero(deps: {
  repo: LibraryRepo
  zotero: { listPapers(col?: string|null): Promise<Paper[]>; listCollections(): Promise<ZoteroCollection[]>;
            findPdfAttachmentInfo(k): Promise<{key,filename}|null>; downloadAttachment(k): Promise<ArrayBuffer> }
  zoteroLocal: { readPdf(k, f): Uint8Array | null }
  writePdf(paperKey: string, bytes: Uint8Array): string   // 写 library/<key>.pdf,返回文件名
  onProgress?: (done: number, total: number, title: string) => void
}): Promise<{ papers: number; folders: number; pdfs: number; pdfMissing: number }>
```
流程:listCollections→upsertFolder(id=collection key);listPapers()→upsertPaper(key 沿用,createdAt=Date.now());逐 collection listPapers(colKey) 聚合 paper→folderIds→setPaperFolders;逐篇 findPdfAttachmentInfo→local 读或 web 下载→writePdf→setPaperPdf;单篇 PDF 失败计 pdfMissing 继续。

- [ ] 测试(全 mock):key 沿用;folders 层级/多归属;PDF local 命中不走 web、local 无走 web、都失败 pdfMissing++ 且条目保留;重复跑幂等;进度回调次数。
- [ ] 绿 → commit `feat(paperdesk): zotero-import`。

### Task 5: container + IPC 换源

**Files:** Modify `src/main/container.ts`(+library、libraryDir)、`src/main/ipc.ts`;Test 更新受影响单测

- [ ] container:`const libraryDir = join(userData, 'library')`(mkdirSync recursive);`const library = createLibraryRepo({ db })`;导出 `{ ..., library, libraryDir }`。
- [ ] ipc 换源(通道名不动):
  - `zotero:list` → `c.library.listPapers(collectionKey)`
  - `zotero:collections` → `c.library.listFolders()`
  - `paper:pdf`/getPaperTextCached/getPaperTextPaged:`findPdfAttachmentInfo+readPdfBytes` → `const f = c.library.getPdfFile(paper.key); f ? new Uint8Array(fs.readFileSync(join(c.libraryDir, f))) : null`;文本缓存键改 `paper.key`。
  - `kb:status`/`kb:index`/`kb:ask` scope 过滤/`kb:review` → `c.library.listPapers(...)`。
  - `highlights:sync` 保留原样(仍走 zotero;UI L4 退役)。
- [ ] `npx tsc --noEmit`=0;全 vitest 绿(修受影响 mock);commit `feat(paperdesk): IPC 读路径换本地文献库`。

### Task 6: 迁移 IPC + 空态一键迁移 UI

**Files:** Modify `src/main/ipc.ts`、`src/preload/index.ts`、`src/renderer/components/LibraryView.tsx`、`src/renderer/styles.css`;Test `tests/renderer/LibraryView.test.tsx` 增用例

**Interfaces:** Produces
```ts
// preload
migrateStatus(): Promise<{ hasPaperLens: boolean; paperCount: number }>
migrateRun(onProgress: (phase: 'paperlens'|'zotero', done: number, total: number, label: string) => void):
  Promise<{ fromPaperLens: boolean; papers: number; pdfs: number; pdfMissing: number }>
```
- [ ] ipc `migrate:status`:hasPaperLens = fs.existsSync(旧 userData/paperlens/paperlens.db);paperCount = c.library.countPapers()。
- [ ] ipc `migrate:run`:① 若 hasPaperLens 且 notes/chunks 皆空 → importFromPaperLens + copyModelsDir(旧 models → 新 models);② 若配置有 zoteroApiKey → importFromZotero(进度经 `migrate:progress` 转发);in-flight 防重入。
- [ ] LibraryView:papers 为空且 !loading 时显示 `.lib-migrate` 块——「🚚 一键迁移(PaperLens 数据 + Zotero 文献)」按钮 + 进度行;完成后刷新列表与文件夹。hasPaperLens=false 时按钮文案「从 Zotero 导入文献」。
- [ ] 组件测试:空库显示迁移按钮;点击调 migrateRun;进度渲染;完成后重新 listPapers。
- [ ] 绿 → commit `feat(paperdesk): 一键双源迁移`。

### Task 7: 真机验证 + 打包并存

- [ ] `npm run build`;临时驱动(参照 e2e-drive 模式,appName=paperdesk):清空 userData → 触发 migrate:run → 断言:listPapers().length===20、listFolders().length===30、kbStatus().embeddedChunks===1789、打开一篇论文 paper:pdf 有字节、chat 历史/笔记随库可见;日志写 /tmp 轮询。
- [ ] Electron ABI → `npm run dist` → 二进制 ABI/窗口验证 → 安装 /Applications(与 PaperLens 并存)→ lsregister 清理。
- [ ] 全 vitest + tsc 最终绿;commit `feat(paperdesk): L1 完成` + push。

## 验收(对照设计)

旧 PaperLens 笔记/高亮/对话/1789 向量块在 PaperDesk 全部可见可用;20 篇文献含 PDF、30 文件夹树正常;不再需要配置 Zotero 即可日常使用;PaperLens 原样未动。
