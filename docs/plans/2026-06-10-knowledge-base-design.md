# PaperLens 知识库（Knowledge Base）— 设计文档

> 状态：已获用户批准（2026-06-10）。检索方案 K-A「FTS5 + LLM 双语查询扩写」。
> 下游：writing-plans 产出逐任务 TDD 实现计划。

## 需求（用户确认）

1. **形态：两者都要**——全库 AI 问答 + 跨论文笔记聚合浏览，合一为「知识库」页面。
2. **范围：自动索引全库**——后台对所有论文（含未打开过的）做 PDF 全文抽取并建索引；纯本地计算零 API 费，首次建库几十秒～几分钟，之后增量。

## 被否方案与理由

- **K-B 本地向量 RAG**：真语义检索，但 +100MB 模型下载、重依赖、索引慢；几十篇规模性价比低。接口已预留，未来召回不足时可平滑升级。
- **K-C 纯笔记知识库**：无全文问答，不满足需求。

## 技术前提（已实测验证）

better-sqlite3 的 FTS5 + trigram tokenizer：英文与 ≥3 字符中文 `MATCH` 可用（bm25 排序）；**2 字中文词 MATCH 不到**（trigram 限制），用 `LIKE '%词%'` 兜底（trigram 表对 ≥3 字 LIKE 有索引优化，2 字走扫描、量级小无碍）。检索策略 = MATCH（≥3 字符词）∪ LIKE（短词），合并去重。

## 设计

### §1 入口与布局
左栏头部新增「🧠 知识库」按钮（⚙设置旁）。近全屏覆盖层（~900px 宽、90vh，复用模态模式 + Esc 关闭）。上方**全库问答**区；下方 Tab：「📝 我的笔记」/「📄 索引状态」。共享类型 `ChatMessage`/`Note` 不动。

### §2 数据层（migrate v2，向后兼容）
- 新表 `chunks(id INTEGER PK, paper_key TEXT, paper_title TEXT, seq INTEGER, text TEXT)`。
- FTS5 虚表 `chunks_fts(text, tokenize='trigram')`，external-content 指向 `chunks`，同步触发器（insert/delete）。
- `notes-repo.listAll(): Note[]`（时间倒序）。
- 纯函数 `chunkText(text, size=1200, overlap=150): string[]`。

### §3 索引器（主进程，零 API 费）
- `kb:index`：遍历 `zotero.listPapers()` 全库 → 跳过已索引（chunks 中存在 paper_key 且非空）→ `getPaperTextCached`（复用本地 storage 读取 + pdfjs 抽取 + pdf_cache）→ `chunkText` → 入 `chunks`；每篇完成发 `kb:progress (done, total, title)`；无 PDF/抽取失败跳过并计入 skipped。
- `kb:status` → `{ indexedPapers, totalPapers, totalChunks }`。
- 知识库打开时自动触发增量索引；另有「更新索引」按钮。

### §4 全库问答（K-A）
`kb:ask(question)`：
1. **扩写**：`buildQueryExpansionMessages(question)` → `complete`（小调用）→ `parseQueryTerms` 解析 3–6 个中英检索词（JSON 数组，容错回退 `[question]`）。
2. **检索**：`searchChunks(db, terms, k=8)`——每词按长度走 MATCH(bm25) 或 LIKE，合并去重按命中词数+bm25 排序取 top-8。
3. **作答**：`buildKbAnswerMessages(question, hits)`（系统提示：只依据段落、引用标 [来源N]、不知道就说不知道）→ `stream` 经 `kb:token(delta, kind)` 流式推送。
4. 返回 `{ answer, sources: [{ paperKey, title }] }`（来源 = 命中段落所属论文去重）。
- preload：`kbIndex(onProgress)`, `kbStatus()`, `kbAsk(question, onToken): Promise<{answer, sources}>`, `listAllNotes()`。

### §5 UI / 错误 / 测试
- **KnowledgeView**：问答输入 + 流式 Markdown 答案（复用 `Markdown` 组件）+ 来源 chips（点击 → 关闭知识库并选中该论文，经 `onOpenPaper(paperKey)` 回调，App 据 papers 列表解析为 Paper）。「我的笔记」：关键词 + 标签 chips 客户端筛选，按论文分组卡片。「索引状态」：n/total、chunks 数、跳过数、「更新索引」按钮 + 进度条。
- 错误：单篇索引失败跳过；问答失败 alert 横幅；索引为空时问答区提示先建索引。
- 测试：chunkText/扩写与作答 prompt/parseQueryTerms 纯函数 TDD；searchChunks 内存 sqlite TDD（MATCH/LIKE/合并排序/中文短词）；KnowledgeView RTL（mock api）；App 入口 RTL；driver 增 KB 步骤（QUICK 模式验打开/状态/笔记）。
- 成本：每问 = 1 次小扩写 + 1 次流式作答；索引零 API 费。
