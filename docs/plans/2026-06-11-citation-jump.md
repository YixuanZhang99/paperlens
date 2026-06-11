# PaperLens 引用定位 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 单篇对话里 AI 回答标 `[页N]`，点击跳到该论文 PDF 那页并高亮——「读↔问」可核实闭环第一批。

**Architecture:** 已批准设计 `docs/plans/2026-06-11-citation-jump-design.md`（方案1）。抽取层可选注入 `[第N页]` 标记（隔离 KB/精读）；chat 走带页标记正文 + prompt 要求标注；`Markdown` 把 `[页N]` 渲染成可点 chip；点击经 App 的 `jumpTarget` 状态联动 ReaderView 切 PDF tab、滚动到第 N 个 canvas、闪烁高亮。

**Tech Stack:** 现有栈，零新依赖。基线分支 `feature/citation-jump`（HEAD `0d298fd`），main 已并入 chat v2，全量 **157 passed + 2 skipped**，tsc 0。ABI 舞步：vitest 前 `npm rebuild better-sqlite3`（系统 ABI），electron/driver 前 `npx @electron/rebuild -f -w better-sqlite3 -v 32.3.3`。macOS 无 `timeout` 命令。

**计数预期：** CJ-1 后 159，CJ-3 后 161，CJ-4 后 164，CJ-5 后 166，CJ-6 后 168，CJ-7 后 169（±，以实际为准）。

---

### Task CJ-1: pdf-service 可选页标记

**Files:**
- Modify: `paperlens/src/main/services/pdf-service.ts`
- Test: `paperlens/tests/main/pdf-service.test.ts`（若无则新建）

**Step 1: 失败测试**
```ts
import { describe, it, expect } from 'vitest'
import { extractPdfText } from '../../src/main/services/pdf-service'

function fakeDoc(pages: string[]) {
  return {
    numPages: pages.length,
    async getPage(n: number) { return { async getTextContent() { return { items: pages[n - 1].split(' ').map(str => ({ str })) } } } },
  }
}

describe('extractPdfText pageMarkers', () => {
  it('injects [第N页] before each page when pageMarkers=true', async () => {
    const t = await extractPdfText(new Uint8Array(), { loadDocument: async () => fakeDoc(['alpha', 'beta']), pageMarkers: true })
    expect(t).toContain('[第1页]')
    expect(t).toContain('[第2页]')
    expect(t.indexOf('[第1页]')).toBeLessThan(t.indexOf('alpha'))
    expect(t.indexOf('alpha')).toBeLessThan(t.indexOf('[第2页]'))
  })
  it('omits markers by default (KB/deepread unchanged)', async () => {
    const t = await extractPdfText(new Uint8Array(), { loadDocument: async () => fakeDoc(['alpha', 'beta']) })
    expect(t).not.toContain('[第1页]')
    expect(t).toContain('alpha')
  })
})
```

**Step 2: 红** `cd /Users/zhangyixuan06/work/paperlens && npx vitest run tests/main/pdf-service.test.ts` → pageMarkers 测 FAIL。

**Step 3: 实现** —— 改 `extractPdfText`：
```ts
export interface ExtractOptions {
  loadDocument?: (data: Uint8Array) => Promise<FakeDoc>
  maxChars?: number
  pageMarkers?: boolean   // true：每页前注入 [第N页]，供对话引用定位；默认 false（KB/精读纯文本）
}

export async function extractPdfText(bytes: Uint8Array, opts: ExtractOptions = {}): Promise<string> {
  const load = opts.loadDocument ?? realLoadDocument
  const maxChars = opts.maxChars ?? 120_000
  const doc = await load(bytes)
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const body = content.items.map(it => it.str).join(' ')
    pages.push(opts.pageMarkers ? `[第${i}页]\n${body}` : body)
    if (pages.join('\n').length >= maxChars) break
  }
  return pages.join('\n').slice(0, maxChars)
}
```

**Step 4: 绿** 2 passed；`npx tsc --noEmit` 0；全量需系统 ABI **159 passed + 2 skipped**。

**Step 5: Commit** `git add paperlens/src/main/services/pdf-service.ts paperlens/tests/main/pdf-service.test.ts && git commit -m "feat: pdf-service optional [第N页] page markers"`

---

### Task CJ-2: getPaperTextPaged + IPC + preload（胶水）

**Files:**
- Modify: `paperlens/src/main/ipc.ts`、`paperlens/src/preload/index.ts`

**Step 1: ipc.ts** —— 在 `getPaperTextCached` 旁新增带页标记的取文（独立内存缓存，零迁移、不碰 pdf_cache/KB）：
```ts
// 对话引用定位专用：带 [第N页] 标记的正文。会话内存缓存（按附件 key），重启重抽取。
const pagedTextCache = new Map<string, string>()
async function getPaperTextPaged(c: Container, paper: Paper): Promise<string> {
  const info = await c.zotero().findPdfAttachmentInfo(paper.key)
  if (!info) return ''
  const hit = pagedTextCache.get(info.key)
  if (hit !== undefined) return hit
  const bytes = await readPdfBytes(c, info)
  if (!bytes) return ''
  const text = await extractPdfText(bytes, { pageMarkers: true })
  pagedTextCache.set(info.key, text)
  return text
}
```
注册 handler（放在 `paper:text` 附近）：
```ts
ipcMain.handle('paper:textPaged', (_e, paper: Paper): Promise<string> => getPaperTextPaged(c, paper))
```

**Step 2: preload/index.ts** —— api 加：
```ts
getPaperTextPaged: (paper: Paper): Promise<string> => ipcRenderer.invoke('paper:textPaged', paper),
```

**Step 3: 验证** `npx tsc --noEmit` 0；`npx vitest run` 不回归（159+2）；`npm run build` 成功。

**Step 4: Commit** `git add paperlens/src/main/ipc.ts paperlens/src/preload/index.ts && git commit -m "feat: getPaperTextPaged ipc (paged text for chat citation)"`

---

### Task CJ-3: buildMessages 页码标注指令

**Files:**
- Modify: `paperlens/src/main/services/ai-chat.ts`（buildMessages 的 system content）
- Test: `paperlens/tests/main/ai-chat.test.ts`（追加 1 测）

**Step 1: 失败测试**（追加）：
```ts
it('buildMessages instructs page citation with [页N]', () => {
  const { messages } = buildMessages({ paper: { title: 'T', authors: [], year: 2020 } as any, paperText: '[第1页]\n正文', history: [], userInput: 'q' })
  expect(messages[0].content).toMatch(/\[页N\]|页码|\[第N页\]/)
})
```

**Step 2: 红。Step 3: 实现** —— 在 system content 现有「只依据论文内容作答…」之后追加一句：
```
'\n当正文中出现 [第N页] 标记时，它表示该页起始；你引用论文具体内容时，请在该句末尾标注 [页N]（N 为页码），便于用户跳转核对。'
```

**Step 4: 绿** ai-chat 全绿；tsc 0；全量 **161 passed + 2 skipped**。

**Step 5: Commit** `git add paperlens/src/main/services/ai-chat.ts paperlens/tests/main/ai-chat.test.ts && git commit -m "feat: prompt instructs [页N] citation annotation"`

---

### Task CJ-4: Markdown 渲染可点 [页N] chip

**Files:**
- Modify: `paperlens/src/renderer/components/Markdown.tsx`
- Test: `paperlens/tests/renderer/Markdown.test.tsx`（新建）

**Step 1: 失败测试**
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Markdown } from '../../src/renderer/components/Markdown'

describe('Markdown page citations', () => {
  it('renders [页N] as a clickable chip and fires onPageJump', () => {
    const onPageJump = vi.fn()
    render(<Markdown onPageJump={onPageJump}>{'结论很重要 [页3]。'}</Markdown>)
    const btn = screen.getByRole('button', { name: '[页3]' })
    fireEvent.click(btn)
    expect(onPageJump).toHaveBeenCalledWith(3)
  })
  it('leaves [页N] as plain text when onPageJump is absent', () => {
    render(<Markdown>{'结论 [页3]。'}</Markdown>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/\[页3\]/)).toBeInTheDocument()
  })
})
```

**Step 2: 红**（onPageJump 未支持）。

**Step 3: 实现** —— Markdown.tsx 重写：
```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ReactNode } from 'react'

const PAGE_RE = /\[页(\d+)\]/g

// 把文本里的 [页N] 替换成可点 chip，递归处理 react-markdown 传入的 children（字符串/数组）
function linkifyPages(children: ReactNode, onPageJump: (p: number) => void): ReactNode {
  if (typeof children === 'string') {
    const parts: ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    PAGE_RE.lastIndex = 0
    while ((m = PAGE_RE.exec(children)) !== null) {
      if (m.index > last) parts.push(children.slice(last, m.index))
      const page = Number(m[1])
      parts.push(
        <button key={`${m.index}-${page}`} className="page-cite" onClick={() => onPageJump(page)}>[页{page}]</button>
      )
      last = m.index + m[0].length
    }
    if (parts.length === 0) return children
    if (last < children.length) parts.push(children.slice(last))
    return parts
  }
  if (Array.isArray(children)) return children.map((c, i) => <span key={i}>{linkifyPages(c, onPageJump)}</span>)
  return children
}

export function Markdown({ children, onPageJump }: { children: string; onPageJump?: (page: number) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components = onPageJump
    ? {
        p: ({ children }: any) => <p>{linkifyPages(children, onPageJump)}</p>,
        li: ({ children }: any) => <li>{linkifyPages(children, onPageJump)}</li>,
      }
    : undefined
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  )
}
```

**Step 4: 绿** Markdown 2 passed；tsc 0；全量 renderer 不回归（**164 passed + 2 skipped**）。

**Step 5: Commit** `git add paperlens/src/renderer/components/Markdown.tsx paperlens/tests/renderer/Markdown.test.tsx && git commit -m "feat: Markdown renders [页N] as clickable page-cite chip"`

---

### Task CJ-5: ChatView 用 paged 正文 + 上抛 onPageJump

**Files:**
- Modify: `paperlens/src/renderer/components/ChatView.tsx`
- Test: `paperlens/tests/renderer/ChatView.test.tsx`（mock + 1 测）

**Step 1: 失败测试** —— makeApi 加 `getPaperTextPaged: vi.fn(async () => '[第1页]\n论文全文')`；新增：
```tsx
it('renders [页N] chips in assistant reply and calls onPageJump', async () => {
  const streamChat = vi.fn(async (_a: any, onToken: any) => {
    onToken('见 [页2]', 'content')
    return { text: '见 [页2]', truncated: false, usedChars: 10, totalChars: 10 }
  })
  const onPageJump = vi.fn()
  ;(window as any).api = makeApi({ streamChat })
  render(<ChatView paper={paper} onPageJump={onPageJump} />)
  await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
  fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
  fireEvent.click(screen.getByRole('button', { name: /发送/ }))
  const chip = await screen.findByRole('button', { name: '[页2]' })
  fireEvent.click(chip)
  expect(onPageJump).toHaveBeenCalledWith(2)
})
```
（注意：makeApi 默认补 `getPaperTextPaged`，否则挂载即崩。）

**Step 2: 红。Step 3: 实现** —— ChatView：
1. props 加 `onPageJump?: (page: number) => void`。
2. 正文加载改用 paged：`window.api.getPaperTextPaged(paper)` 替换 `getPaperText`（竞态守卫的 useEffect 内，保持 cancelled 逻辑）。
3. assistant 气泡的 `<Markdown>` 传 `onPageJump`：`<Markdown onPageJump={onPageJump}>{m.content}</Markdown>`（仅 assistant，user 气泡不传）。

**Step 4: 绿** ChatView 全绿（含新测）；tsc 0；**166 passed + 2 skipped**。

**Step 5: Commit** `git add paperlens/src/renderer/components/ChatView.tsx paperlens/tests/renderer/ChatView.test.tsx && git commit -m "feat: ChatView uses paged text + surfaces [页N] jumps"`

---

### Task CJ-6: ReaderView 接收 jumpTarget → 切 tab + 滚动 + 高亮

**Files:**
- Modify: `paperlens/src/renderer/components/ReaderView.tsx`
- Test: `paperlens/tests/renderer/ReaderView.test.tsx`（追加）

**Step 1: 失败测试**（沿用该文件 mock 模式；`scrollIntoView` jsdom 无，需 stub）：
```tsx
it('switches to PDF tab and loads pdf when a jumpTarget for this paper arrives', async () => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const getPaperPdf = vi.fn(async () => new ArrayBuffer(8))
  ;(window as any).api = { ...(window as any).api, getPaperPdf, listNotes: vi.fn(async () => []) }
  const paper = { key: 'P1', title: 'T', authors: [], year: 2020, abstract: '', attachmentKey: null }
  const { rerender } = render(<ReaderView paper={paper} jumpTarget={null} />)
  rerender(<ReaderView paper={paper} jumpTarget={{ paperKey: 'P1', page: 2, nonce: 1 }} />)
  await waitFor(() => expect(getPaperPdf).toHaveBeenCalled())
})
```

**Step 2: 红。Step 3: 实现** —— ReaderView：
1. props 加 `jumpTarget?: { paperKey: string; page: number; nonce: number } | null`。
2. 把 `openPdf` 抽成返回 Promise（已是 async，确保 await 完成加载）。
3. 加 effect：
```tsx
useEffect(() => {
  if (!jumpTarget || !paper || jumpTarget.paperKey !== paper.key) return
  let cancelled = false
  ;(async () => {
    if (tab !== 'pdf' || pdfData === null) await openPdf()
    for (let i = 0; i < 80 && !cancelled; i++) {
      const canvases = document.querySelectorAll('.pdf-stage canvas')
      if (canvases.length >= jumpTarget.page) {
        const el = canvases[jumpTarget.page - 1] as HTMLElement
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add('page-flash')
        setTimeout(() => el.classList.remove('page-flash'), 1500)
        return
      }
      await new Promise(r => setTimeout(r, 200))
    }
  })()
  return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [jumpTarget?.nonce])
```

**Step 4: 绿** ReaderView 全绿；tsc 0；**168 passed + 2 skipped**。

**Step 5: Commit** `git add paperlens/src/renderer/components/ReaderView.tsx paperlens/tests/renderer/ReaderView.test.tsx && git commit -m "feat: ReaderView jumps to page + flash on jumpTarget"`

---

### Task CJ-7: App 串联 jumpTarget

**Files:**
- Modify: `paperlens/src/renderer/App.tsx`
- Test: `paperlens/tests/renderer/App.test.tsx`（追加；mock 补 getPaperTextPaged/getPaperPdf）

**Step 1: 失败测试**
```tsx
it('routes a [页N] click in chat to the reader (switches to PDF tab)', async () => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  ;(window as any).api.listPapers = vi.fn(async () => [{ key: 'P1', title: 'T', authors: [], year: 2020, abstract: '', attachmentKey: null }])
  ;(window as any).api.getPaperTextPaged = vi.fn(async () => '[第1页]\n正文')
  ;(window as any).api.getPaperPdf = vi.fn(async () => new ArrayBuffer(8))
  ;(window as any).api.streamChat = vi.fn(async (_a: any, onToken: any) => { onToken('见 [页1]', 'content'); return { text: '见 [页1]', truncated: false, usedChars: 1, totalChars: 1 } })
  render(<App />)
  fireEvent.click(await screen.findByText(/T/))
  // 选论文后在右栏问一句，点 [页1]
  await waitFor(() => expect(screen.getByRole('button', { name: /发送/ })).not.toBeDisabled())
  fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
  fireEvent.click(screen.getByRole('button', { name: /发送/ }))
  fireEvent.click(await screen.findByRole('button', { name: '[页1]' }))
  await waitFor(() => expect((window as any).api.getPaperPdf).toHaveBeenCalled())
})
```
（如该集成测试在 jsdom 下过脆，可降级为：App 渲染时 ChatView 收到非空 onPageJump prop + ReaderView 收到 jumpTarget prop 的契约测试。）

**Step 2: 红。Step 3: 实现** —— App：
1. `const [jumpTarget, setJumpTarget] = useState<{ paperKey: string; page: number; nonce: number } | null>(null)`；`const jumpNonce = useRef(0)`。
2. ChatView 传 `onPageJump={(page) => { if (selected) setJumpTarget({ paperKey: selected.key, page, nonce: ++jumpNonce.current }) }}`。
3. ReaderView 传 `jumpTarget={jumpTarget}`。

**Step 4: 绿** App 全绿；tsc 0；**169 passed + 2 skipped**。

**Step 5: Commit** `git add paperlens/src/renderer/App.tsx paperlens/tests/renderer/App.test.tsx && git commit -m "feat: App routes chat [页N] clicks to reader jumpTarget"`

---

### Task CJ-8: 样式 + driver + SMOKE + 交付

**Files:**
- Modify: `paperlens/src/renderer/styles.css`、`paperlens/scripts/e2e-drive.mjs`、`paperlens/docs/SMOKE.md`

**Step 1: styles.css 追加**
```css
/* 引用定位 */
.page-cite {
  display: inline; padding: 0 5px; margin: 0 1px;
  font-size: 12px; line-height: 1.4;
  color: var(--accent); background: var(--accent-soft);
  border: 1px solid var(--accent-border); border-radius: 4px; cursor: pointer;
}
.page-cite:hover { background: #e2e6fd; }
.page-flash { animation: pageFlash 1.5s ease-out; }
@keyframes pageFlash {
  0%, 40% { box-shadow: 0 0 0 3px var(--accent), 0 1px 4px rgba(0,0,0,.2); }
  100% { box-shadow: 0 1px 4px rgba(0,0,0,.2); }
}
```

**Step 2: e2e-drive.mjs** —— 在对话步骤区（DRIVE_QUICK 之外）加一步：选论文后问「这篇论文第二页讲了什么？」类问题不稳定；改为**确定性 DOM 验证**——注入一段含 `[页1]` 的 assistant 文本不现实（真实流式）。改为轻量：真实问一句，等回答，若回答含 `.page-cite` 则点击首个并断言阅读区切到 PDF（`section[aria-label="阅读"] .pdf-stage` 出现）。该步仅在 `DRIVE_KB_ASK`（或新 `DRIVE_CITE`）时跑，避免 QUICK 付费。截图 `15-citation-jump.png`。
```js
if (process.env.DRIVE_CITE) {
  await js(`document.querySelectorAll('nav .paper-item')[0].click(); return true`)
  await waitFor('chat ready', `const s=[...document.querySelectorAll('section[aria-label="对话"] button')].find(b=>b.textContent.trim()==='发送'); return s && !s.disabled`, 30000)
  await js(`const t=document.querySelector('section[aria-label="对话"] .chat-textarea'); const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; s.call(t,'请引用论文具体页码，简述第二页的内容。'); t.dispatchEvent(new Event('input',{bubbles:true})); return true`)
  await js(`[...document.querySelectorAll('section[aria-label="对话"] button')].find(b=>b.textContent.trim()==='发送').click(); return true`)
  await waitFor('cite answered', `const s=[...document.querySelectorAll('section[aria-label="对话"] button')].find(b=>b.textContent.trim()==='发送'); const b=document.querySelector('section[aria-label="对话"] .bubble.assistant'); return s && !s.disabled && b && b.textContent.length>20`, 120000, 1500)
  const hasCite = await js(`return document.querySelectorAll('.page-cite').length`)
  if (hasCite) {
    await js(`document.querySelector('.page-cite').click(); return true`)
    await waitFor('pdf jumped', `return !!document.querySelector('section[aria-label="阅读"] .pdf-stage canvas')`, 30000, 1000)
    await shot('15-citation-jump.png'); ok('citation-jump', `chips=${hasCite}`)
  } else { ok('citation-jump', 'AI 本轮未标页码（可接受降级）') }
}
```

**Step 3: SMOKE.md** —— 步骤 4b 后或新增：
```markdown
4c. [ ] 让 AI 引用页码（如问「第二页讲了什么」）→ 回答里出现蓝色 [页N] chip → 点击 → 中栏自动切到「全文 PDF」并滚动到第 N 页、该页边框高亮闪烁。AI 偶尔不标或标错页属可接受降级。
```

**Step 4: 回归 + 交付**（ABI 舞步）
- 系统 ABI：`npm rebuild better-sqlite3` → `npx vitest run`（169+2）→ `npx tsc --noEmit` 0。
- Electron ABI：`npx @electron/rebuild -f -w better-sqlite3 -v 32.3.3` → `npm run build` → `DRIVE_QUICK=1 ./node_modules/.bin/electron scripts/e2e-drive.mjs`（原步骤不回归）→ `DRIVE_CITE=1 ./node_modules/.bin/electron scripts/e2e-drive.mjs`（验证引用定位）→ 截图亲验 `15-citation-jump.png`。

**Step 5: Commit + 合并交付**
```bash
git add paperlens/src/renderer/styles.css paperlens/scripts/e2e-drive.mjs paperlens/docs/SMOKE.md
git commit -m "test+docs+style: citation jump driver step, smoke, page-cite/flash styles"
```
切回 Electron ABI、`npm run dev` 重启。

---

## 里程碑

| 里程碑 | Task | 验收 |
|---|---|---|
| M1 服务层 | CJ-1..CJ-3 | 161+2 全绿（页标记+paged取文+prompt） |
| M2 渲染与联动 | CJ-4..CJ-7 | 169+2 全绿（chip+ChatView+ReaderView+App） |
| M3 交付 | CJ-8 | driver 引用定位截图亲验 + 重启 |

## 给执行者的提醒
- ABI 舞步贯穿；macOS 无 `timeout`。
- `getPaperTextPaged` 用会话内存缓存，**不碰 pdf_cache/KB chunks**（隔离，零迁移）。
- Markdown 的 `onPageJump` 只在 ChatView 的 assistant 气泡传；精读/知识库的 Markdown 不传 → 行为完全不变（回归保护）。
- ReaderView 跳页用 `document.querySelectorAll('.pdf-stage canvas')` 轮询等 PdfCanvas 异步渲染完；jsdom 测不了真实滚动，scroll/flash 由真实 driver 验。
- AI 标错页/越界是可接受降级，不可抛错。
