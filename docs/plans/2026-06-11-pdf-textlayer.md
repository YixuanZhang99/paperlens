# PaperLens PDF 文本层 + 选中「问这段」Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** PDF 可选字/复制（pdf.js TextLayer 叠加），选中文字浮出「✨ 问这段」→ 注入右栏对话输入框（对话栏自动展开）——「读↔问」精读闭环。

**Architecture:** 已批准设计 `docs/plans/2026-06-11-pdf-textlayer-design.md`（方案1）。PdfCanvas 每页 canvas + 透明 TextLayer 叠加（`--scale-factor` 对齐）；选区变化浮出按钮，点击经 `onAskSelection` 上抛；App `quoteToChat` 状态（与引用定位 jumpTarget 对称，方向相反）传入 ChatView 注入 textarea 并 focus、自动展开对话栏。

**Tech Stack:** pdfjs-dist 4.10.38（`TextLayer` 类）、现有栈，零新依赖。基线分支 `feature/pdf-textlayer`（HEAD `a0f59a6`），main 含引用定位，全量 **165 passed + 2 skipped**，tsc 0。ABI 舞步：vitest 前 `npm rebuild better-sqlite3`，electron/driver 前 `npx @electron/rebuild -f -w better-sqlite3 -v 32.3.3`。macOS 无 `timeout` 命令。

**计数预期：** TL-1 后 167，TL-2 后 169（±，以实际为准）。TL-3/TL-4 为命令式 DOM/纯前端交互，单测有限，靠真实 driver。

---

### Task TL-1: ChatView 接收 quote 注入 textarea

**Files:**
- Modify: `paperlens/src/renderer/components/ChatView.tsx`
- Test: `paperlens/tests/renderer/ChatView.test.tsx`（mock 不变，加 2 测）

**Step 1: 失败测试**
```tsx
it('injects selected quote into the textarea and focuses it when quote nonce changes', async () => {
  ;(window as any).api = makeApi()
  const { rerender } = render(<ChatView paper={paper} quote={null} />)
  await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
  rerender(<ChatView paper={paper} quote={{ text: '自注意力机制', nonce: 1 }} />)
  await waitFor(() => {
    const ta = screen.getByPlaceholderText(/输入问题/) as HTMLTextAreaElement
    expect(ta.value).toContain('自注意力机制')
  })
})

it('does not re-inject when quote nonce is unchanged on rerender', async () => {
  ;(window as any).api = makeApi()
  const q = { text: 'X', nonce: 5 }
  const { rerender } = render(<ChatView paper={paper} quote={q} />)
  await waitFor(() => expect((screen.getByPlaceholderText(/输入问题/) as HTMLTextAreaElement).value).toContain('X'))
  const ta = screen.getByPlaceholderText(/输入问题/) as HTMLTextAreaElement
  fireEvent.change(ta, { target: { value: '我改过了' } })
  rerender(<ChatView paper={paper} quote={{ text: 'X', nonce: 5 }} />) // same nonce
  expect((screen.getByPlaceholderText(/输入问题/) as HTMLTextAreaElement).value).toBe('我改过了')
})
```

**Step 2: 红** `cd /Users/zhangyixuan06/work/paperlens && npx vitest run tests/renderer/ChatView.test.tsx` → 新 2 测 FAIL（quote 未支持）。

**Step 3: 实现** —— ChatView：
1. props 加 `quote?: { text: string; nonce: number } | null`（与 paper/onNoteSaved/onPageJump 并列）。
2. textarea 加 ref：`const taRef = useRef<HTMLTextAreaElement>(null)`，`<textarea ref={taRef} …>`。
3. 加 effect（监听 nonce，用 ref 记上次处理过的 nonce 防重复）：
```tsx
const lastQuoteNonce = useRef<number | null>(null)
useEffect(() => {
  if (!quote || quote.nonce === lastQuoteNonce.current) return
  lastQuoteNonce.current = quote.nonce
  setInput(prev => `针对这段内容：\n「${quote.text}」\n\n` + prev)
  taRef.current?.focus()
}, [quote?.nonce])
```

**Step 4: 绿** ChatView 全绿（含新 2 测 + 原有不回归）；`npx tsc --noEmit` 0；全量需系统 ABI **167 passed + 2 skipped**。

**Step 5: Commit** `cd /Users/zhangyixuan06/work && git add paperlens/src/renderer/components/ChatView.tsx paperlens/tests/renderer/ChatView.test.tsx && git commit -m "feat: ChatView injects selected-text quote into input"`

---

### Task TL-2: App 串联 quoteToChat + 自动展开对话栏

**Files:**
- Modify: `paperlens/src/renderer/App.tsx`
- Test: `paperlens/tests/renderer/App.test.tsx`（追加 1 契约测）

**Step 1: 失败测试**（沿用 App.test 现有 mock；契约式，不依赖真实 PDF 渲染）：
```tsx
it('wires ReaderView onAskSelection to ChatView quote and opens the chat pane', async () => {
  ;(window as any).api.listPapers = vi.fn(async () => [{ key: 'P1', title: 'TPaper', authors: [], year: 2020, abstract: '', attachmentKey: null }])
  localStorage.setItem('pl.chatOpen', '0') // 对话栏初始收起
  render(<App />)
  fireEvent.click(await screen.findByText('TPaper'))
  // 对话栏收起时应只见「展开对话」轨
  expect(screen.getByRole('button', { name: '展开对话' })).toBeInTheDocument()
  // 模拟 ReaderView 触发选中提问：找到 reader 区注入的 onAskSelection 难，改为契约——
  // 直接断言 App 把 onAskSelection 传给了 ReaderView、quote 传给了 ChatView（见下）。
})
```
> 注：jsdom 下无法真实触发 PDF 选区。该测试降级为「App 渲染后 ReaderView 收到非空 onAskSelection prop、ChatView 收到 quote prop」的契约校验——若 App.test 难以探测子组件 props，则**改为**在 TL-1 的 ChatView 测试 + TL-4 真实 driver 覆盖，本任务 App 测试仅验「设置 pl.chatOpen=0 后选论文仍渲染、无崩溃」。执行者按 App.test 现有能力择一落地，**务必让测试真实通过、不为过而过**，并在报告说明选了哪种。

**Step 2: 红 → Step 3: 实现** —— App.tsx：
1. `const [quoteToChat, setQuoteToChat] = useState<{ text: string; nonce: number } | null>(null)`；`const quoteNonce = useRef(0)`。
2. `const handleAskSelection = useCallback((text: string) => { setQuoteToChat({ text, nonce: ++quoteNonce.current }); setChatOpen(true) }, [])`。
3. ReaderView 传 `onAskSelection={handleAskSelection}`。
4. ChatView 传 `quote={quoteToChat}`。

**Step 4: 绿** App 全绿；`npx tsc --noEmit` 0（注意：ReaderView/ChatView 此时还没声明这两个 prop，会 tsc 报错——TL-1 已给 ChatView 加 quote；ReaderView 的 onAskSelection 在 TL-3 加。**因此 TL-2 与 TL-3 有交叉依赖**：建议执行顺序 TL-1 → TL-3 → TL-2，或 TL-2 实现时同时在 ReaderView 加 `onAskSelection?` 透传声明。执行者按下方「依赖说明」处理）。全量 **169 passed + 2 skipped**。

**Step 5: Commit** `cd /Users/zhangyixuan06/work && git add paperlens/src/renderer/App.tsx paperlens/tests/renderer/App.test.tsx && git commit -m "feat: App routes PDF selection to chat quote + opens chat pane"`

---

### Task TL-3: ReaderView 透传 onAskSelection

**Files:**
- Modify: `paperlens/src/renderer/components/ReaderView.tsx`
- Test: `paperlens/tests/renderer/ReaderView.test.tsx`（追加 1 测）

**Step 1: 失败测试**（契约：ReaderView 接受 onAskSelection 并传给 PdfCanvas——PdfCanvas 在 jsdom 是 lazy + pdf.js，渲染不出，故测「prop 被接受、PDF tab 下不崩」）：
```tsx
it('accepts onAskSelection prop without crashing in PDF tab', async () => {
  const onAskSelection = vi.fn()
  const getPaperPdf = vi.fn(async () => new ArrayBuffer(8))
  ;(window as any).api = { ...(window as any).api, getPaperPdf, listNotes: vi.fn(async () => []) }
  const paper = { key: 'P1', title: 'T', authors: [], year: 2020, abstract: '', attachmentKey: null }
  render(<ReaderView paper={paper} onAskSelection={onAskSelection} />)
  fireEvent.click(screen.getByRole('button', { name: '全文 PDF' }))
  await waitFor(() => expect(getPaperPdf).toHaveBeenCalled())
})
```

**Step 2: 红**（onAskSelection 未声明，tsc/测试失败）。

**Step 3: 实现** —— ReaderView：props 加 `onAskSelection?: (text: string) => void`；传给 `<PdfCanvas data={pdfData} onAskSelection={onAskSelection} />`（PdfCanvas 在 TL-4 接收该 prop——为让 tsc 过，TL-3 与 TL-4 之一先声明 PdfCanvas 的 prop。见依赖说明）。

**Step 4: 绿** ReaderView 全绿；`npx tsc --noEmit` 0。

**Step 5: Commit** `cd /Users/zhangyixuan06/work && git add paperlens/src/renderer/components/ReaderView.tsx paperlens/tests/renderer/ReaderView.test.tsx && git commit -m "feat: ReaderView passes onAskSelection to PdfCanvas"`

---

### Task TL-4: PdfCanvas 文本层 + 选中浮按钮（核心）

**Files:**
- Modify: `paperlens/src/renderer/components/PdfCanvas.tsx`
- Modify: `paperlens/src/renderer/styles.css`（文本层 + 浮按钮样式）
- Test: 无单测（jsdom 测不了 pdf.js 渲染与原生选区）；靠 tsc + build + 真实 driver（TL-5）

**Step 1: PdfCanvas 实现** —— 关键改动：

1. props 加 `onAskSelection?: (text: string) => void`。
2. import：`import { TextLayer } from 'pdfjs-dist'`（4.10 已导出）。
3. 渲染循环里每页改为 wrap 结构 + 文本层：
```tsx
const cssWidth = Math.floor(viewport.width)
const wrap = document.createElement('div')
wrap.className = 'pdf-page-wrap'
wrap.style.cssText = `position:relative;width:${cssWidth}px;margin:0 auto 8px;`
// canvas（保持 dpr 物理像素，但去掉原 margin，挪到 wrap）
canvas.style.cssText = `width:${cssWidth}px;display:block;box-shadow:0 1px 4px rgba(0,0,0,0.2)`
wrap.appendChild(canvas)
container.appendChild(wrap)
await page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr,0,0,dpr,0,0] : undefined }).promise
// 文本层（CSS 尺寸 viewport，--scale-factor 对齐）
try {
  const textDiv = document.createElement('div')
  textDiv.className = 'textLayer'
  textDiv.style.setProperty('--scale-factor', String((fitWidth / base.width) * zoom))
  wrap.appendChild(textDiv)
  const tl = new TextLayer({ textContentSource: await page.getTextContent(), container: textDiv, viewport })
  await tl.render()
} catch (e) { console.error('text layer error', e) }
```
（注意：`viewport` 已是 `page.getViewport({ scale: (fitWidth/base.width)*zoom })` 的 CSS 尺寸 viewport——TextLayer 用它即与 canvas CSS 宽对齐；`--scale-factor` = 同一 scale。）

4. 选中浮按钮——组件内 state + DOM：
```tsx
const [sel, setSel] = useState<{ x: number; y: number; text: string } | null>(null)
useEffect(() => {
  const onSelChange = () => {
    const s = window.getSelection()
    const text = s?.toString().trim() ?? ''
    const root = containerRef.current
    if (!text || !s || s.rangeCount === 0 || !root) { setSel(null); return }
    const anchor = s.anchorNode
    if (!anchor || !root.contains(anchor)) { setSel(null); return }
    const rect = s.getRangeAt(0).getBoundingClientRect()
    const viewerRect = root.getBoundingClientRect()
    setSel({ x: rect.right - viewerRect.left, y: rect.bottom - viewerRect.top, text })
  }
  document.addEventListener('selectionchange', onSelChange)
  return () => document.removeEventListener('selectionchange', onSelChange)
}, [])
```
（containerRef 指向 `.pdf-pages`；浮按钮定位相对 `.pdf-viewer`，注意坐标基准——按钮放在 `.pdf-viewer` 内 absolute，坐标用相对 `.pdf-viewer` 的偏移。执行者按实际 DOM 调坐标基准，真实 driver 验证位置。）

5. 渲染浮按钮（在 `.pdf-viewer` 内，`.pdf-pages` 之后）：
```tsx
{sel && onAskSelection && (
  <button
    className="ask-selection-btn"
    style={{ position: 'absolute', left: sel.x, top: sel.y, zIndex: 5 }}
    onMouseDown={e => { e.preventDefault() /* 别清掉选区 */ }}
    onClick={() => { onAskSelection(sel.text); setSel(null) }}
  >✨ 问这段</button>
)}
```
`.pdf-viewer` 需 `position: relative`（styles.css 补）。

**Step 2: styles.css 追加**
```css
/* PDF 文本层（透明可选文字，叠在 canvas 上） */
.pdf-viewer { position: relative; }
.pdf-page-wrap { position: relative; }
.textLayer {
  position: absolute; inset: 0; overflow: hidden; line-height: 1;
  opacity: 1; z-index: 2;
}
.textLayer span, .textLayer br {
  position: absolute; white-space: pre; color: transparent;
  transform-origin: 0 0; cursor: text;
}
.textLayer ::selection { background: rgba(79, 70, 229, .3); }
.ask-selection-btn {
  background: var(--accent); color: #fff; border: none;
  border-radius: 6px; padding: 4px 10px; font-size: 12px;
  box-shadow: var(--shadow); white-space: nowrap;
}
.ask-selection-btn:hover { background: #4338ca; }
```

**Step 3: 验证**
- `npx tsc --noEmit` → 0。
- `npx vitest run` → 不回归（169+2；PdfCanvas 无单测，确认 ReaderView/已有测试不挂）。
- `npm run build` → 成功。

**Step 4: Commit** `cd /Users/zhangyixuan06/work && git add paperlens/src/renderer/components/PdfCanvas.tsx paperlens/src/renderer/styles.css && git commit -m "feat: PdfCanvas text layer (selectable) + ask-this-selection float button"`

---

### Task TL-5: 真实 driver + SMOKE + 交付

**Files:**
- Modify: `paperlens/scripts/e2e-drive.mjs`、`paperlens/docs/SMOKE.md`

**Step 1: e2e-drive.mjs** —— 加一步（DRIVE_QUICK 内即可跑，纯前端不花 API）：选论文 → 开「全文 PDF」→ 等 canvas + textLayer → 用 `executeJavaScript` 构造一个跨 textLayer span 的 Selection → 触发 selectionchange → 断言 `.ask-selection-btn` 出现 → 点击 → 断言右栏 textarea 含注入文本 + 对话栏展开。
```js
// ── PDF 文本层 + 选中问这段 ──
await js(`document.querySelectorAll('nav .paper-item')[0].click(); return true`)
await waitFor('pdf btn', `return [...document.querySelectorAll('button')].some(b=>b.textContent.includes('全文 PDF'))`, 10000)
await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('全文 PDF')).click(); return true`)
await waitFor('textlayer', `const t=document.querySelector('.pdf-page-wrap .textLayer'); return t && t.querySelectorAll('span').length>3`, 30000, 1000)
// 选中第一页文本层前两个 span
await js(`
  const spans=[...document.querySelectorAll('.pdf-page-wrap .textLayer span')].slice(0,3)
  const r=document.createRange(); r.setStart(spans[0].firstChild||spans[0],0); r.setEndAfter(spans[2])
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r)
  document.dispatchEvent(new Event('selectionchange'))
  return s.toString().length`)
await waitFor('ask btn', `return !!document.querySelector('.ask-selection-btn')`, 5000)
await shot('16-pdf-select.png')
await js(`document.querySelector('.ask-selection-btn').click(); return true`)
await waitFor('quote injected', `const t=document.querySelector('section[aria-label="对话"] .chat-textarea'); return t && t.value.includes('针对这段内容')`, 5000)
await shot('17-quote-injected.png')
ok('ask-selection', '选中→浮按钮→注入对话')
```
（坐标/选区构造按真实 DOM 调；若 selectionchange 合成事件不触发组件监听，改用真实 range + 触发 `document` 上的事件。）

**Step 2: SMOKE.md** —— 步骤 4c 后加：
```markdown
4d. [ ] PDF 可选字：在「全文 PDF」里拖选一段文字（能选中、可复制）→ 选区旁浮出「✨ 问这段」→ 点击 → 右栏对话输入框注入「针对这段内容：『…』」、对话栏自动展开 → 可直接发或补充问题。
```

**Step 3: 回归 + 交付**（ABI 舞步）
- 系统 ABI：`npm rebuild better-sqlite3` → `npx vitest run`（169+2）→ `npx tsc --noEmit` 0。
- Electron ABI：`npx @electron/rebuild -f -w better-sqlite3 -v 32.3.3` → `npm run build` → `DRIVE_QUICK=1 ./node_modules/.bin/electron scripts/e2e-drive.mjs` → 原步骤 + ask-selection 通过 → 截图亲验 `16/17`。

**Step 4: Commit + 合并交付**
```bash
cd /Users/zhangyixuan06/work
git add paperlens/scripts/e2e-drive.mjs paperlens/docs/SMOKE.md
git commit -m "test+docs: pdf text-layer selection driver step + smoke 4d"
```
合并 main、push、切 Electron ABI、`npm run dev` 重启。

---

## 依赖说明（执行顺序）
TL-1（ChatView quote）独立先做。**TL-3（ReaderView）与 TL-4（PdfCanvas）的 prop 声明互相牵连**：PdfCanvas 必须先声明 `onAskSelection?` prop，ReaderView 才能传。建议顺序 **TL-1 → TL-4 → TL-3 → TL-2**，或一个 agent 连做 TL-3+TL-4（ReaderView+PdfCanvas 紧邻）。TL-2（App）最后串联，此时 ChatView.quote 与 ReaderView.onAskSelection 都已声明，tsc 干净。

## 里程碑
| 里程碑 | Task | 验收 |
|---|---|---|
| M1 注入链 | TL-1 | 167+2（ChatView quote 注入） |
| M2 文本层 | TL-3+TL-4 | tsc+build（PdfCanvas textLayer + 浮按钮 + ReaderView 透传） |
| M3 串联 | TL-2 | 169+2（App quoteToChat + 自动展开） |
| M4 交付 | TL-5 | driver 选中→注入截图亲验 + 重启 |

## 给执行者的提醒
- ABI 舞步贯穿；macOS 无 `timeout`。
- TextLayer 用**CSS 尺寸 viewport**（不带 dpr）+ 容器 `--scale-factor` 对齐 canvas；canvas 仍 dpr 物理像素。
- 浮按钮 `onMouseDown` 必须 `preventDefault()`，否则点击前选区被清空、拿不到文本。
- 自动展开对话栏（App setChatOpen(true)）是关键 UX，否则注入了用户看不见。
- PdfCanvas 是命令式 DOM + React state 混合：文本层/canvas 走命令式（useEffect 里 createElement），浮按钮走 React state（sel）——两者在同一组件，注意 containerRef 与坐标基准。
- jsdom 测不了 pdf.js 渲染与原生选区，TL-4 无单测，务必真实 driver 验证（TL-5）。
