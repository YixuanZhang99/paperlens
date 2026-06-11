# PaperLens 四件套（Ctrl+F / 句级高亮 / 自动综述 / dmg）— 设计与实现计划

> 状态：设计已获用户批准（2026-06-11，「通过，全部开干」）。
> **For Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 逐任务执行。

**基线**：分支 `feature/batch4`，HEAD 含读↔问双向闭环；**169 passed + 2 skipped**，tsc 0。
**编排**：轨道A（PdfCanvas 系：B4-1 Ctrl+F → B4-2 句级高亮）∥ 轨道B（KB 系：B4-3 综述服务层 → B4-4 综述集成）→ B4-5 回归+driver → B4-6 dmg 打包验证 → 合并交付。
**ABI 舞步**：vitest 前 `npm rebuild better-sqlite3`；electron/driver/dist 前 `npx @electron/rebuild -f -w better-sqlite3 -v 32.3.3`（dist 自带 rebuild）。macOS 无 `timeout`。

---

## §1 Ctrl+F 页内搜索（B4-1，轨道A）

**设计**：PDF 工具条加搜索框；Cmd/Ctrl+F（焦点在 PDF 区时）聚焦，Esc 清空关闭。在所有 `.textLayer span` 文本里大小写不敏感匹配 → 命中 span 加 `.search-hit`（黄底）；「‹ ›」按钮 + `N/M` 计数；当前命中 `.search-hit-active`（橙底）+ scrollIntoView。Enter=下一个、Shift+Enter=上一个。换词/清空时撤销全部高亮类。匹配粒度=span 级（pdf.js 一个 span 一段文字，词可能被切——按 span 文本子串匹配即可，跨 span 词匹配不做，YAGNI）。

**Files**: `src/renderer/components/PdfCanvas.tsx`、`src/renderer/styles.css`。
**实现要点**：搜索状态 React state（query/hits: HTMLElement[]/cur)；textLayer 渲染完后才可搜（重渲染时清结果重搜）；命令式给 span add/remove class。jsdom 测不了（无 pdf.js 渲染），无单测——tsc+build+driver 验。
**验收**：tsc 0、build、全量不回归；driver（B4-5）。
**Commit**: `feat: in-pdf search (Ctrl+F, highlight, prev/next)`

## §2 句级高亮（B4-2，轨道A，依赖 B4-1 落地后做避免 PdfCanvas 冲突）

**设计**：引用从 `[页N]` 升级为可带原文 `[页N:"原文短句"]`（≤40字摘自该页），向后兼容。点 chip → 跳页后在该页 textLayer 匹配片段 → 命中 spans `.sentence-flash`（黄底 3s 渐隐）→ 匹配失败回退整页 `.page-flash`。

**Files**:
- `src/main/services/ai-chat.ts` + `tests/main/ai-chat.test.ts`：buildMessages 指令改为「标注 [页N] 或 [页N:"原文短句"]（短句≤40字、逐字摘自该页）」（+1 测）。
- `src/renderer/lib/quote-match.ts`（新）+ `tests/renderer/quote-match.test.ts`（新）：纯函数
  `findQuoteRange(spanTexts: string[], quote: string): { start: number; end: number } | null`
  ——把 spanTexts 拼接（记录每 span 起止偏移），全文与 quote 都做归一化（去空白、lowercase），indexOf 定位，映射回 span 区间。TDD：命中单 span、跨 span、归一化空白、找不到→null（4 测）。
- `src/renderer/components/Markdown.tsx` + `tests/renderer/Markdown.test.tsx`：PAGE_RE 升级 `/\[页(\d+)(?::"([^"]{1,80})")?\]/g`；chip 显示仍是 `[页N]`；`onPageJump(page, quote?)`（+2 测：带引文调用收到 quote、旧格式 quote 为 undefined）。
- `src/renderer/components/ChatView.tsx`：onPageJump 签名 `(page, quote?)` 透传（类型改）。
- `src/renderer/App.tsx`：jumpTarget 加 `quote?: string`；handlePageJump 收 quote。
- `src/renderer/components/ReaderView.tsx`：跳页 effect 里，滚动后若 `jumpTarget.quote` → 取该页 `.textLayer span` 文本数组 → `findQuoteRange` → 命中给 spans 加 `.sentence-flash`（3s 后移除）且**不加** page-flash；未命中回退 page-flash。
- `styles.css`：`.sentence-flash { background: rgba(250, 204, 21, .55); transition: background 1s ease 2s; }`（或 keyframes 渐隐）。

**验收**：新 ~7 测全绿（176±）、tsc 0；真实验证在 B4-5 driver（问答出 `[页N:"…"]` 不确定性高，driver 允许降级：有 quote 则验句级、无则验整页）。
**Commit**: `feat: sentence-level citation highlight ([页N:"quote"] → textLayer match flash)`

## §3 自动综述（B4-3 服务层 ∥ 轨道B；B4-4 集成）

**设计**：知识库模态加「📝 生成综述」区：范围下拉（全部论文 / 各 collection，复用 listCollections）→ 点击显示「将对 N 篇已索引论文发起 N+1 次 AI 调用」确认 → map 阶段逐篇取**前 3 个 chunk**（开头=摘要/引言最有代表性）让 DeepSeek 提炼要点（进度 x/N）→ reduce 阶段流式生成结构化综述（## 主题分组 / ## 方法对照 / ## 主要分歧 / ## 开放问题）→ 预览 + 「存为笔记」（paperKey=范围内第一篇，内容头部注明综述范围与篇数；走现有 addNote/Notion 管线）。

**B4-3 服务层 Files**：`src/main/services/kb.ts` + `tests/main/kb-review.test.ts`（新）。
- `representativeChunks(db, paperKey, k=3): string[]`——`SELECT text FROM chunks WHERE paper_key=? ORDER BY seq ASC LIMIT ?`。
- `buildReviewMapMessages(paperTitle: string, chunks: string[]): ChatMessage[]`——system：文献综述助手，基于片段提炼该论文 3-5 条核心要点（方法/结论/局限），Markdown bullet，≤300字；user：标题+片段。
- `buildReviewReduceMessages(scopeLabel: string, items: Array<{ title: string; points: string }>): ChatMessage[]`——system：基于各论文要点写结构化中文综述，必含四节 `## 主题分组`、`## 方法对照`、`## 主要分歧`、`## 开放问题`，引用论文用标题；user：scopeLabel + 逐篇要点。
- TDD（~5 测）：representativeChunks 取前 k 按 seq 序/不够 k 返回实际数；两个 build 函数含关键指令与全部输入内容。

**B4-4 集成 Files**：`src/main/ipc.ts`、`src/preload/index.ts`、`src/renderer/components/KnowledgeView.tsx`、`tests/renderer/KnowledgeView.test.tsx`、`styles.css`（.kb-review 区样式）。
- IPC `kb:review`（event, args:{ collectionKey: string | null }）：listPapers(collectionKey) → 过滤 indexedPaperKeys → 逐篇 map（`complete(buildReviewMapMessages(...))`，try/catch 单篇失败跳过，`kb:review-progress (done,total,title)`）→ `stream(buildReviewReduceMessages(...))` 经 `kb:review-token` → 返回 `{ content, papers: 成功篇数, skipped }`。0 篇可综述时优雅返回提示文本。
- preload：`kbReview(args, onProgress, onToken): Promise<{content,papers,skipped}>`（双监听 + finally 移除）。
- KnowledgeView：索引状态 Tab 下方加「生成综述」区——collection 下拉（`listCollections`，默认全部）、按钮、确认行（显示 N+1 次调用预估，再点确认才发）、进度条文本、流式 Markdown 预览、完成后「存为笔记」按钮（addNote autoTag）。mock 注意补 `listCollections`/`kbReview`。RTL（~3 测）：确认流程（首点出确认、再点调 kbReview）、流式 token 渲染进预览、存为笔记调 addNote。
- **Commit×2**: `feat: review-synthesis prompts + representative chunks` / `feat: kb auto-review (map-reduce, scoped, save as note)`

## §4 dmg 打包验证（B4-6，最后）

**设计**：`npm run dist`（electron-builder，已配置 identity:null 未签名本地包；dist 自动把 native 模块 rebuild 成 Electron ABI）→ 产物 `release/PaperLens-<ver>-arm64.dmg` + `release/mac-arm64/PaperLens.app`。
**验证**：直接 `open release/mac-arm64/PaperLens.app`（与 dmg 同内容，免挂载）→ sleep 8 → `ps aux | grep PaperLens.app` 进程存活 → osascript 检查窗口存在 → 截图（screencapture 或 osascript）目检 → 退出应用（osascript quit）。已知风险自查：打包后 pdfjs worker、config.enc 读取（app.getPath userData 同名 paperlens 自动一致）、better-sqlite3 ABI（dist 自动处理）。
**注意**：dist 后 node_modules 是 Electron ABI——后续跑 vitest 要先 npm rebuild。
**Commit**: 无代码（产物不入 git；release/ 已 gitignore）。SMOKE.md 打包节补充验证结论。

## §5 B4-5 回归 + driver

- driver 加两步（QUICK 内）：**pdf-search**——开 PDF、等 textLayer、向搜索框注入高频词（如 'the' 或从 textLayer 取首个长词）、断言 `.search-hit` 数 >0 且计数文本 `1/M`、点「›」断言 active 移动；**review 不进 driver**（花 N+1 次调用，手动 SMOKE 验证；可加 DRIVE_REVIEW 开关留接口但默认不跑）。句级高亮并入 DRIVE_CITE 步：回答含 `[页N:"…"]` 时点击后断言 `.sentence-flash` 出现（无引文则维持现断言）。
- SMOKE.md：4e 搜索、4f 句级高亮、14 生成综述 三条。
- 全链：系统 ABI vitest（~177+2）→ tsc 0 → Electron ABI build → DRIVE_QUICK（含 pdf-search）→ DRIVE_CITE → 截图亲验。

## 任务清单
| # | 任务 | 轨道 | 依赖 |
|---|---|---|---|
| B4-1 | Ctrl+F 页内搜索 | A | - |
| B4-3 | 综述服务层（TDD） | B | - |
| B4-2 | 句级高亮（TDD 链） | A | B4-1 |
| B4-4 | 综述 IPC+UI（RTL） | B | B4-3 |
| B4-5 | 回归 + driver + SMOKE | 汇合 | B4-1..4 |
| B4-6 | dmg 打包 + 真机验证 | 汇合 | B4-5 |
