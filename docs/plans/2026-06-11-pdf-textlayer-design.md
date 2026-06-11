# PaperLens PDF 文本层 + 选中「问这段」— 设计文档

> 状态：已获用户批准（2026-06-11）。方案 1「pdf.js TextLayer 类叠加 + 选中浮按钮 + 注入对话」。
> 范围：文本层（选字/复制）+ 选中「问这段」注入输入框。下游：writing-plans 逐任务 TDD 计划。

## 需求（用户确认）

- 「读↔问闭环」第二批，本轮做：**PDF 文本层**（pdf.js TextLayer，选字/复制天然附带）+ **选中 PDF 文字「✨ 问这段」→ 注入右栏对话输入框**（光标在后，可直接发或补充）。
- 不做：Ctrl+F 页内搜索、引用定位升级到句级高亮（下轮）。

## 技术底座（已探索）

- `pdfjs-dist` 4.10.38，导出 `TextLayer` 类（4.x 标准 API）。
- PdfCanvas 命令式渲染：每页 `document.createElement('canvas')` append 到 `.pdf-pages`；缩放（zoom×dpr）重渲染。
- 引用定位已有：`[页N]` chip + App `jumpTarget` → ReaderView 整页跳转 + `.page-flash`。
- ChatView v2：textarea 输入框、对话绑定当前 paper、对话栏可收起（App `chatOpen`）。

## 设计

### §1 文本层叠加（PdfCanvas）
- 每页结构改为 `.pdf-page-wrap`（position: relative）包：`<canvas>`（现有，dpr 物理像素 + CSS 宽）+ `<div class="textLayer">`（position: absolute，覆盖 canvas，CSS 尺寸与 canvas 一致）。
- 用 `new pdfjsLib.TextLayer({ textContentSource: await page.getTextContent(), container: textLayerDiv, viewport })`，viewport 用与 canvas **CSS 宽一致**的 scale（`fitWidth/base.width × zoom`，不带 dpr——textLayer 是 DOM 文字）。`await textLayer.render()`。
- 加文本层 CSS（手写关键样式，避免引整包 pdf_viewer.css）：`.textLayer { position:absolute; inset:0; overflow:hidden; line-height:1; }`、`.textLayer span { position:absolute; color:transparent; white-space:pre; cursor:text; transform-origin:0 0; }`、`.textLayer ::selection { background: rgba(79,70,229,.3); }`、`.textLayer br::selection { background:transparent; }`。pdf.js 4.x 用 CSS 变量 `--scale-factor` 定位 span——容器需设 `style.setProperty('--scale-factor', String(cssScale))`。
- 缩放/换论文重渲染时 textLayer 随 canvas 在同一循环重建（沿用现有 cancelled 守卫）。
- textLayer 渲染失败独立 catch，不影响 canvas 显示。

### §2 选中捕获 + 浮按钮（PdfCanvas）
- `.pdf-viewer` 内维护一个浮动「✨ 问这段」按钮（绝对定位，默认隐藏）。
- 监听 `document` 的 `selectionchange`（防抖）或容器 `mouseup`：取 `window.getSelection()`，若 `toString().trim()` 非空且 `anchorNode` 在 `.pdf-pages` 内 → 用 `range.getBoundingClientRect()` 把按钮定位到选区右下方、显示。
- 点击按钮 → `onAskSelection(text)`（props 回调）→ 隐藏按钮（不强制清选区）。
- 选区变空 / 点到 PDF 外 → 隐藏按钮。

### §3 跨栏注入对话（PdfCanvas → ReaderView → App → ChatView）
- PdfCanvas props 加 `onAskSelection?: (text: string) => void`。
- ReaderView 透传 `onAskSelection` 给 PdfCanvas（ReaderView props 加同名回调）。
- App 持有 `quoteToChat: { text: string; nonce: number } | null` + `quoteNonce` ref。ReaderView 的 `onAskSelection` 上抛到 App → `setQuoteToChat({ text, nonce: ++ })`，并 **`setChatOpen(true)`**（对话栏收起时自动展开，否则注入了也看不见）。
- ChatView props 加 `quote?: { text: string; nonce: number } | null`；effect 监听 `quote?.nonce` 变化 → `setInput(prev => \`针对这段内容：\n「${quote.text}」\n\n\` + prev)`（或直接设置并 focus）→ `textareaRef.current?.focus()`。需给 textarea 加 ref。
- 用户在输入框补充问题或直接发送（整个 input 作为问题，含引用上下文）。

### §4 错误 / 边界 / 测试
- 选区跨页：`getSelection().toString()` 合并多 textLayer 文本，可接受。
- textLayer 与 canvas 对齐靠相同 cssScale（`fitWidth/base.width × zoom`）+ `--scale-factor`。
- 对话栏收起时注入 → 自动展开（§3）。
- 测试：
  - ChatView：`quote` nonce 变化 → textarea 含选中文字、focus（RTL，给 textarea 加 ref）。无 quote/重复 nonce 不重复注入。
  - App：`onAskSelection(text)` → ChatView 收到 quote（且 chatOpen 被设 true）（RTL 契约）。
  - PdfCanvas 的 textLayer 渲染、真实选区、浮按钮 → 注入：jsdom 测不了 pdf.js 渲染与原生选区，由真实 driver 用 `executeJavaScript` 构造 selection range + 点按钮，断言对话输入框含引用文本，截图亲验。
- 成本：零额外 API（纯前端交互；发问才调 DeepSeek）。

## 下轮（不做）
Ctrl+F 页内搜索高亮跳转；引用定位 `[页N]` 升级到句级高亮（AI 标原文片段 + textLayer 匹配）。
