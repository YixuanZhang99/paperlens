# PaperLens 引用定位（Citation Jump）— 设计文档

> 状态：已获用户批准（2026-06-11）。方案 1「LLM 标注页码 + 渲染可点 chip + 跳页高亮」。
> 范围：**仅单篇对话**、**整页级**定位。下游：writing-plans 产出逐任务 TDD 计划。

## 需求（用户确认）

- 「读↔问闭环」第一批：**引用定位**（句级高亮 + 选中「问这段」+ PDF 文本层留作下一批）。
- 场景：**单篇对话**（ChatView）——回答标 `[页N]`，点击跳到该论文 PDF 那页并高亮。知识库引用定位放后面。
- 粒度：**整页级**（跳到页 + 整页高亮闪烁），不依赖 PDF 文本层。

## 被否方案

- 方案2（事后文本检索定位）：更准但需文本匹配逻辑、交互重。
- 方案3（按页切 chunk 走检索）：会把单篇对话退化成检索，丢掉全文上下文。

## 技术现状（已探索）

- `pdf-service.extractPdfText` 逐页抽取但 `pages.join('\n')` **丢弃页边界**。
- `PdfCanvas` 纯 canvas（每页一个 `<canvas>`，缩放轮所做），**无文本层**。
- `ReaderView` 摘要/全文 PDF 双 tab，`paper.key` 变时重置回 summary。
- `pdf_cache` 缓存纯文本；KB chunks 仅有 seq 无页码；精读用纯文本。

## 设计

### §1 抽取层（保留页码，隔离 KB/精读）
- `extractPdfText` 增加 `opts.pageMarkers?: boolean`：true 时每页前注入 `\n[第N页]\n` 再 join；默认 false，**KB 索引/精读路径行为完全不变**。
- 新增主进程取文路径 `getPaperTextPaged(c, paper)`：与 `getPaperTextCached` 并存，带页标记，独立缓存键（如 `pdf_cache_paged` 或内存缓存），仅供 chat。零迁移、不动已建 KB 索引。
- IPC：`paper:textPaged`；preload：`getPaperTextPaged`。

### §2 prompt 层
`buildMessages` 的 system 末尾追加一句：「正文中 `[第N页]` 标记该页起始；当你的回答引用论文具体内容时，在该句末尾标注 `[页N]`（N 为页码）。」其余构建逻辑、截断治理、history 不变。ChatView 改用 `getPaperTextPaged` 取正文喂 `streamChat`。

### §3 渲染层（Markdown 可点 chip）
`Markdown` 组件接受可选 `onPageJump?: (page: number) => void`。开启时，把渲染后文本节点里的 `[页N]`（正则 `/\[页(\d+)\]/g`）替换为 `<button class="page-cite">[页N]</button>`，点击 `onPageJump(N)`。未传 `onPageJump` 时行为不变（纯文本），不影响精读/知识库等其它 Markdown 使用处。

### §4 跳转联动（右栏 → 中栏）
- App 新增状态 `jumpTarget: { paperKey: string; page: number; nonce: number } | null`（nonce 保证同页重复点击也能触发）。
- ChatView 的气泡 `<Markdown onPageJump={p => onPageJump(p)}>`，`onPageJump` 经 props 上抛到 App → `setJumpTarget({ paperKey: paper.key, page, nonce })`。
- ReaderView 接收 `jumpTarget` prop：当 `jumpTarget.paperKey === paper.key` 且 nonce 变化 → 切到 PDF tab（必要时先 `openPdf()` 加载）→ 等 canvas 就绪 → 滚动到第 N 个 `.pdf-pages > canvas`（`scrollIntoView`）→ 给该 canvas 加 `.page-flash` 类（~1.5s 高亮边框后移除）。
- PdfCanvas 不变（已是每页一 canvas），ReaderView 通过 ref/DOM 查询第 N 个 canvas。

### §5 错误处理 / 测试
- `[页N]` 越界（N>总页数或 PDF 未就绪过久）：chip 仍渲染，跳转时若第 N 个 canvas 不存在则滚到最接近页或忽略（不报错）。
- AI 标错页：用户手动翻，可接受降级。
- 测试：
  - `pdf-service`：pageMarkers=true 注入 `[第N页]`、false 不变（单测）。
  - `buildMessages`：system 含页码标注说明（单测）。
  - `Markdown`：`[页2]` → 可点 button、点击回调收到 2；无 onPageJump 时为纯文本（RTL）。
  - `ReaderView`：jumpTarget 变化 → 切 PDF tab + 目标 canvas scrollIntoView + flash 类（RTL，mock canvas）。
  - `App`：ChatView 点 [页N] → ReaderView 收到 jumpTarget（RTL）。
  - 真实驱动：选论文→问→回答含 `[页N]`→点击→PDF 切 tab 跳页高亮（截图亲验）。
- 成本：零额外 API（页码靠抽取标记 + 同一次作答调用）。

## 下轮（不做）
PDF 文本层（pdf.js TextLayer）→ 句级高亮定位 + 选中 PDF 文字「问这段」+ 选字/复制/Ctrl+F。知识库来源页码定位。
