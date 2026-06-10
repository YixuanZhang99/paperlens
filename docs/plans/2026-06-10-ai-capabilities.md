# PaperLens AI 能力增强 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 PaperLens 增加 4 项 AI 能力——一键结构化精读（直接存为带标签的笔记）、快捷提问模板、AI 自动打标签、深度思考模式（deepseek-reasoner + 思维链灰显）。

**Architecture:** 已批准设计 `docs/plans/2026-06-10-ai-capabilities-design.md`（方案 C：按职责落位）。prompt 构建与标签解析为 `ai-chat.ts` 纯函数（可单测）；`stream()` 回调扩展 `kind: 'content'|'reasoning'`（向后兼容）；精读走独立 IPC `paper:deepread` 不污染聊天；打标签为主进程 `generateTags`（失败回空，不阻塞）；快捷提问纯前端 chips。共享 `ChatMessage` 类型不动。

**Tech Stack:** 现有栈不变（Electron + React + TS + Vitest + RTL）。无新依赖。

**基线：** main `17b5a8d`，56 tests passed + 1 skipped，tsc clean。所有任务在新分支 `feature/ai-capabilities` 上进行（开工前 `git checkout -b feature/ai-capabilities`）。

**测试计数预期：** A1 后 57，A2 后 64，A5 后 67，A6 后 69（+1 skipped 不变）。

---

### Task A1: `stream()` 支持 reasoning_content（kind 回调）

**Files:**
- Modify: `paperlens/src/main/services/ai-chat.ts:48-84`（stream 函数）
- Test: `paperlens/tests/main/ai-stream.test.ts`（追加 1 测）

**Step 1: 写失败测试** —— 追加到 `tests/main/ai-stream.test.ts` 的 `describe('createAiChat.stream', ...)` 内（`sseResponse` helper 已存在）：

```ts
  it('delivers reasoning_content with kind=reasoning, excluded from the returned text', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"让我想想…"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"核心是X。"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"是X"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    )
    const chat = createAiChat({ apiKey: 'k', model: 'deepseek-reasoner', fetch })
    const events: Array<[string, string]> = []
    const full = await chat.stream([{ role: 'user', content: 'q' }], (d, kind) => events.push([kind, d]))
    expect(events).toEqual([
      ['reasoning', '让我想想…'],
      ['reasoning', '核心是X。'],
      ['content', '答案'],
      ['content', '是X'],
    ])
    expect(full).toBe('答案是X')
  })
```

**Step 2: 运行验证失败**

Run: `cd /Users/zhangyixuan06/work/paperlens && npx vitest run tests/main/ai-stream.test.ts`
Expected: 新测试 FAIL——当前 `onToken` 单参数，`kind` 为 undefined，`events` 第一项是 `[undefined, ...]` 且 reasoning delta 根本不会被分发（解析器只读 `content`）。原 4 测仍 PASS。

**Step 3: 最小实现** —— 修改 `ai-chat.ts`：

1. 在 `AiChatDeps` 接口前加一行类型导出：
```ts
export type StreamTokenKind = 'content' | 'reasoning'
```
2. `stream` 签名改为：
```ts
  async function stream(messages: ChatMessage[], onToken: (delta: string, kind: StreamTokenKind) => void): Promise<string> {
```
3. 解析块（原 71-77 行 try 内）替换为：
```ts
          const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> }
          const d = json.choices?.[0]?.delta
          if (d?.reasoning_content) onToken(d.reasoning_content, 'reasoning')
          if (d?.content) {
            full += d.content
            onToken(d.content, 'content')
          }
```
其余不动（buffer 逻辑、返回值仅累计 content）。现有调用方 `(d) => …`（ipc.ts:66 与 4 个旧测试）因 TS 允许少参回调而保持类型兼容。

**Step 4: 运行验证通过**

Run: `npx vitest run tests/main/ai-stream.test.ts` → 5 passed。
Run: `npx tsc --noEmit` → exit 0。
Run: `npx vitest run` → **57 passed + 1 skipped**（全量无回归）。

**Step 5: Commit**
```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/ai-chat.ts paperlens/tests/main/ai-stream.test.ts
git commit -m "feat: stream() distinguishes reasoning_content via kind callback"
```

---

### Task A2: 精读/标签 prompt 构建 + parseTags（纯函数）

**Files:**
- Modify: `paperlens/src/main/services/ai-chat.ts`（文件末尾追加 3 个导出函数）
- Test: `paperlens/tests/main/ai-tasks.test.ts`（新建）

**Step 1: 写失败测试** —— 新建 `tests/main/ai-tasks.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildDeepReadMessages, buildTagMessages, parseTags } from '../../src/main/services/ai-chat'
import type { Paper } from '@shared/types'

const paper: Paper = {
  key: 'P1', title: 'Transformer', authors: ['Vaswani'], year: 2017,
  abstract: 'attention', attachmentKey: null,
}

describe('buildDeepReadMessages', () => {
  it('builds system prompt with metadata, five sections, and the paper text', () => {
    const msgs = buildDeepReadMessages(paper, '正文ABC')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    for (const s of ['背景问题', '核心贡献', '方法', '实验与结论', '局限与展望']) {
      expect(msgs[0].content).toContain(s)
    }
    expect(msgs[0].content).toContain('Transformer')
    expect(msgs[0].content).toContain('正文ABC')
    expect(msgs[1].role).toBe('user')
  })

  it('truncates paper text to maxContextChars', () => {
    const msgs = buildDeepReadMessages(paper, 'X'.repeat(1000), 100)
    expect(msgs[0].content).toContain('X'.repeat(100))
    expect(msgs[0].content).not.toContain('X'.repeat(101))
  })
})

describe('buildTagMessages', () => {
  it('asks for a JSON array and truncates long content', () => {
    const msgs = buildTagMessages('内容'.repeat(5000))
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('JSON')
    expect(msgs[1].content.length).toBeLessThanOrEqual(4000)
  })
})

describe('parseTags', () => {
  it('parses a plain JSON array', () => {
    expect(parseTags('["transformer","注意力机制"]')).toEqual(['transformer', '注意力机制'])
  })
  it('parses an array inside a markdown fence with surrounding prose', () => {
    expect(parseTags('好的，标签如下：\n```json\n["nlp","LLM"]\n```')).toEqual(['nlp', 'LLM'])
  })
  it('returns [] for garbage / no array / bad json', () => {
    expect(parseTags('没有数组')).toEqual([])
    expect(parseTags('[1, 2, }')).toEqual([])
  })
  it('filters non-strings/blanks and caps at 4', () => {
    expect(parseTags('[1, "a", "", "b", "c", "d", "e"]')).toEqual(['a', 'b', 'c', 'd'])
  })
})
```

**Step 2: 运行验证失败**

Run: `npx vitest run tests/main/ai-tasks.test.ts`
Expected: FAIL（3 个函数未导出）。

**Step 3: 最小实现** —— `ai-chat.ts` 末尾追加：

```ts
export function buildDeepReadMessages(paper: Paper, paperText: string, maxContextChars = 60_000): ChatMessage[] {
  const text = paperText.slice(0, maxContextChars)
  const meta = `标题：${paper.title}\n作者：${paper.authors.join(', ')}\n年份：${paper.year ?? '未知'}`
  return [
    {
      role: 'system',
      content:
        `你是一个严谨的论文精读助手。请基于论文内容输出结构化精读笔记（Markdown），` +
        `依次包含五节：## 背景问题、## 核心贡献、## 方法、## 实验与结论、## 局限与展望。` +
        `内容务必忠于原文，不确定处明确说明。\n\n【论文元数据】\n${meta}\n\n【论文正文（可能截断）】\n${text}`,
    },
    { role: 'user', content: '请输出这篇论文的结构化精读笔记。' },
  ]
}

export function buildTagMessages(content: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是一个文献标签助手。请为给定笔记内容生成 2-4 个主题标签（中文或英文术语，每个不超过 12 字），' +
        '只输出一个 JSON 字符串数组，例如 ["transformer","注意力机制"]，不要任何其他文字。',
    },
    { role: 'user', content: content.slice(0, 4_000) },
  ]
}

export function parseTags(text: string): string[] {
  const m = text.match(/\[[\s\S]*?\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map(t => t.trim())
      .slice(0, 4)
  } catch {
    return []
  }
}
```

**Step 4: 运行验证通过**

Run: `npx vitest run tests/main/ai-tasks.test.ts` → 7 passed。
Run: `npx tsc --noEmit` → exit 0。`npx vitest run` → **64 passed + 1 skipped**。

**Step 5: Commit**
```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/ai-chat.ts paperlens/tests/main/ai-tasks.test.ts
git commit -m "feat: deep-read & tag prompt builders + parseTags (pure functions)"
```

---

### Task A3: deepThink 接线（container ai(model?) + chat:stream + preload）

无单测（Electron 胶水）；验收 = tsc 0 + 64 测试不破 + build 成功。

**Files:**
- Modify: `paperlens/src/main/container.ts:48`
- Modify: `paperlens/src/main/ipc.ts:64-67`
- Modify: `paperlens/src/preload/index.ts:12-21`

**Step 1: container** —— 第 48 行 `ai` 工厂改为：
```ts
  const ai = (model?: string) => createAiChat({ apiKey: cfg().deepseekApiKey, model: model ?? cfg().deepseekModel, fetch })
```

**Step 2: ipc `chat:stream`** —— 替换为：
```ts
  ipcMain.handle('chat:stream', async (event, args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string; deepThink?: boolean }) => {
    const messages = buildMessages({ paper: args.paper, paperText: args.paperText, history: args.history, userInput: args.input })
    return c.ai(args.deepThink ? 'deepseek-reasoner' : undefined)
      .stream(messages, (delta, kind) => event.sender.send('chat:token', delta, kind))
  })
```

**Step 3: preload `streamChat`** —— 替换为：
```ts
  streamChat: (
    args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string; deepThink?: boolean },
    onToken: (delta: string, kind: 'content' | 'reasoning') => void,
  ): Promise<string> => {
    const listener = (_e: Electron.IpcRendererEvent, delta: string, kind: 'content' | 'reasoning') => onToken(delta, kind)
    ipcRenderer.on('chat:token', listener)
    return ipcRenderer.invoke('chat:stream', args).finally(() => {
      ipcRenderer.removeListener('chat:token', listener)
    })
  },
```

**Step 4: 验证**

Run: `npx tsc --noEmit` → exit 0；`npx vitest run` → 64 passed + 1 skipped；`npm run build` → success。

**Step 5: Commit**
```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/container.ts paperlens/src/main/ipc.ts paperlens/src/preload/index.ts
git commit -m "feat: deepThink wiring (model override + kind through chat:token)"
```

---

### Task A4: 精读 IPC + generateTags + notes:add autoTag + preload deepReadPaper

无单测（胶水）；验收 = tsc 0 + 64 测试不破 + build 成功。复用逻辑全部提炼，不复制。

**Files:**
- Modify: `paperlens/src/main/ipc.ts`
- Modify: `paperlens/src/preload/index.ts`

**Step 1: ipc.ts** —— 改 import 行：
```ts
import { buildMessages, buildDeepReadMessages, buildTagMessages, parseTags } from './services/ai-chat'
```
在 `readPdfBytes` 之后追加两个模块级 helper（`getPaperTextCached` 的函数体 = 现有 `paper:text` handler 的函数体，原样搬移）：
```ts
// 论文全文（含 sqlite 缓存）——paper:text 与 paper:deepread 共用
async function getPaperTextCached(c: Container, paper: Paper): Promise<string> {
  const info = await c.zotero().findPdfAttachmentInfo(paper.key)
  if (!info) return ''
  const cached = c.db.prepare('SELECT text FROM pdf_cache WHERE attachment_key = ?').get(info.key) as { text: string } | undefined
  if (cached) return cached.text
  const bytes = await readPdfBytes(c, info)
  if (!bytes) return ''
  const text = await extractPdfText(bytes)
  if (text) {
    c.db.prepare('INSERT OR REPLACE INTO pdf_cache (attachment_key, text, cached_at) VALUES (?, ?, ?)')
      .run(info.key, text, Date.now())
  }
  return text
}

// AI 生成 2-4 个标签；任何失败回退空数组，绝不阻塞保存
async function generateTags(c: Container, content: string): Promise<string[]> {
  try {
    return parseTags(await c.ai().complete(buildTagMessages(content)))
  } catch {
    return []
  }
}
```
`paper:text` handler 砍成一行委托：
```ts
  ipcMain.handle('paper:text', (_e, paper: Paper): Promise<string> => getPaperTextCached(c, paper))
```
`notes:add` 替换为：
```ts
  ipcMain.handle('notes:add', async (_e, n: { paperKey: string; content: string; tags: string[]; autoTag?: boolean }) => {
    const tags = n.autoTag && n.tags.length === 0 ? await generateTags(c, n.content) : n.tags
    return c.notesRepo.add({ paperKey: n.paperKey, content: n.content, tags })
  })
```
在 `notes:sync` 之后追加精读 handler：
```ts
  // 一键结构化精读：流式生成 → 自动打标签 → 直接存为笔记
  ipcMain.handle('paper:deepread', async (event, paper: Paper) => {
    const paperText = await getPaperTextCached(c, paper)
    const messages = buildDeepReadMessages(
      paper, paperText || '（未能获取论文正文。请仅基于元数据撰写，并在开头明确说明缺乏正文。）')
    const content = await c.ai().stream(messages, (delta, kind) => event.sender.send('deepread:token', delta, kind))
    if (!content) throw new Error('精读生成失败：AI 未返回内容')
    const tags = await generateTags(c, content)
    return c.notesRepo.add({ paperKey: paper.key, content, tags })
  })
```

**Step 2: preload** —— `addNote` 参数加 `autoTag?: boolean`（仅类型，invoke 不变）：
```ts
  addNote: (n: { paperKey: string; content: string; tags: string[]; autoTag?: boolean }): Promise<Note> =>
    ipcRenderer.invoke('notes:add', n),
```
`syncNote` 之后追加：
```ts
  deepReadPaper: (paper: Paper, onToken: (delta: string, kind: 'content' | 'reasoning') => void): Promise<Note> => {
    const listener = (_e: Electron.IpcRendererEvent, delta: string, kind: 'content' | 'reasoning') => onToken(delta, kind)
    ipcRenderer.on('deepread:token', listener)
    return ipcRenderer.invoke('paper:deepread', paper).finally(() => {
      ipcRenderer.removeListener('deepread:token', listener)
    })
  },
```

**Step 3: 验证**

Run: `npx tsc --noEmit` → exit 0；`npx vitest run` → 64 passed + 1 skipped；`npm run build` → success。

**Step 4: Commit**
```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/ipc.ts paperlens/src/preload/index.ts
git commit -m "feat: paper:deepread ipc + generateTags + notes:add autoTag"
```

---

### Task A5: ChatView——快捷提问 chips + 深思开关 + 思维链灰显 + autoTag 存笔记

**Files:**
- Modify: `paperlens/src/renderer/components/ChatView.tsx`（整文件替换）
- Test: `paperlens/tests/renderer/ChatView.test.tsx`（追加 3 测 + 改 1 处断言）

**Step 1: 写失败测试** —— 在 `describe('ChatView', ...)` 内追加：

```tsx
  it('renders quick prompt chips and sends the prompt on click', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => { onToken('好的', 'content'); return '好的' })
    ;(window as any).api = { getPaperText: vi.fn(async () => 'x'), streamChat }
    render(<ChatView paper={paper} />)
    fireEvent.click(screen.getByRole('button', { name: '核心贡献' }))
    expect(await screen.findByText('好的')).toBeInTheDocument()
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.stringContaining('核心贡献') }),
      expect.any(Function),
    )
  })

  it('passes deepThink=true when the 深思 toggle is on', async () => {
    const streamChat = vi.fn(async () => '答')
    ;(window as any).api = { getPaperText: vi.fn(async () => 'x'), streamChat }
    render(<ChatView paper={paper} />)
    fireEvent.click(screen.getByLabelText('深思'))
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await waitFor(() => expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ deepThink: true }), expect.any(Function)))
  })

  it('renders reasoning tokens in a separate dimmed block above the answer', async () => {
    const streamChat = vi.fn(async (_a: any, onToken: any) => {
      onToken('思考过程…', 'reasoning'); onToken('最终答案', 'content'); return '最终答案'
    })
    ;(window as any).api = { getPaperText: vi.fn(async () => 'x'), streamChat }
    render(<ChatView paper={paper} />)
    fireEvent.change(screen.getByPlaceholderText(/输入问题/), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(await screen.findByText('思考过程…')).toBeInTheDocument()
    expect(await screen.findByText('最终答案')).toBeInTheDocument()
  })
```
并把现有「saves the last assistant reply as a note」测试中的 `addNote` 断言改为：
```tsx
    await waitFor(() => expect(addNote).toHaveBeenCalledWith(
      expect.objectContaining({ paperKey: 'P1', content: '可保存的学习要点', autoTag: true })
    ))
```

**Step 2: 运行验证失败**

Run: `npx vitest run tests/renderer/ChatView.test.tsx`
Expected: 4 处 FAIL（无 chips 按钮、无 深思 label、reasoning 当 content 拼进答案文本找不到独立块、autoTag 未传）。原其余测试 PASS。

**Step 3: 实现** —— `ChatView.tsx` 整文件替换：

```tsx
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Paper } from '@shared/types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const QUICK_PROMPTS: Array<{ label: string; prompt: string }> = [
  { label: '核心贡献', prompt: '这篇论文的核心贡献是什么？' },
  { label: '方法解读', prompt: '请解读论文的方法部分，关键设计是什么？' },
  { label: '实验与结论', prompt: '论文的实验设置和主要结论是什么？' },
  { label: '局限与改进', prompt: '这篇论文有哪些局限性？可以如何改进？' },
  { label: '大白话解释', prompt: '用通俗的大白话解释这篇论文做了什么、为什么重要。' },
]

// 气泡 = 共享 ChatMessage + 仅 UI 持有的思维链（传给 API 前剥离）
type Bubble = ChatMessage & { reasoning?: string }

export function ChatView({ paper }: { paper: Paper | null }) {
  const [history, setHistory] = useState<Bubble[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [deepThink, setDeepThink] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paperText = useRef('')

  useEffect(() => {
    setHistory([])
    setError(null)
    paperText.current = ''
    if (paper) window.api.getPaperText(paper).then(t => { paperText.current = t })
  }, [paper?.key])

  if (!paper) return <div style={{ padding: 12, color: '#888' }}>请选择一篇论文开始对话</div>

  async function send(text?: string) {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setError(null)
    const userMsg: Bubble = { role: 'user', content: q }
    const priorHistory = history
    setHistory([...priorHistory, userMsg, { role: 'assistant', content: '' }])
    if (text === undefined) setInput('')
    setBusy(true)
    try {
      await window.api.streamChat(
        {
          paper: paper!, paperText: paperText.current,
          history: priorHistory.map(({ role, content }) => ({ role, content })),
          input: q, deepThink,
        },
        (delta, kind) => {
          setHistory(h => {
            const copy = h.slice()
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = kind === 'reasoning'
                ? { ...last, reasoning: (last.reasoning ?? '') + delta }
                : { ...last, content: last.content + delta }
            }
            return copy
          })
        },
      )
    } catch (e) {
      setError('AI 回复失败：' + errMsg(e))
      setHistory(h => {
        const last = h[h.length - 1]
        return last && last.role === 'assistant' && !last.content ? h.slice(0, -1) : h
      })
    } finally {
      setBusy(false)
    }
  }

  async function saveLastAsNote() {
    const last = [...history].reverse().find(m => m.role === 'assistant')
    if (last && last.content) {
      await window.api.addNote({ paperKey: paper!.key, content: last.content, tags: [], autoTag: true })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {history.map((m, i) => (
          <div key={i} style={{ margin: '8px 0', textAlign: m.role === 'user' ? 'right' : 'left' }}>
            {m.reasoning && (
              <div style={{ color: '#999', fontSize: 12, whiteSpace: 'pre-wrap', borderLeft: '3px solid #ddd', padding: '4px 8px', marginBottom: 4 }}>
                {m.reasoning}
              </div>
            )}
            <span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: 8, background: m.role === 'user' ? '#def' : '#f0f0f0', whiteSpace: 'pre-wrap' }}>
              {m.content || (busy && m.role === 'assistant' ? '…' : '')}
            </span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #ddd', padding: 8 }}>
        {error && <div role="alert" style={{ color: 'crimson', fontSize: 13, marginBottom: 6 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {QUICK_PROMPTS.map(p => (
            <button key={p.label} onClick={() => send(p.prompt)} disabled={busy} style={{ fontSize: 12 }}>{p.label}</button>
          ))}
        </div>
        <button onClick={saveLastAsNote} disabled={busy || !history.some(m => m.role === 'assistant' && m.content)}>存为笔记</button>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <input
            placeholder="输入问题…" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send() }}
            style={{ flex: 1 }} />
          <label style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={deepThink} onChange={e => setDeepThink(e.target.checked)} />深思
          </label>
          <button onClick={() => send()} disabled={busy}>发送</button>
        </div>
      </div>
    </div>
  )
}
```
注意：chips 点击 `send(p.prompt)` 时 `text !== undefined` → 不清空输入框草稿；`history` 传 API 前 `.map(({role,content}) => ...)` 剥离 reasoning。

**Step 4: 运行验证通过**

Run: `npx vitest run tests/renderer/ChatView.test.tsx` → 6 passed（原 3 + 新 3）。
Run: `npx tsc --noEmit` → exit 0；`npx vitest run` → **67 passed + 1 skipped**（App.test 仍绿）。

**Step 5: Commit**
```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/renderer/components/ChatView.tsx paperlens/tests/renderer/ChatView.test.tsx
git commit -m "feat: quick prompts, deep-think toggle, reasoning display, autoTag save"
```

---

### Task A6: ReaderView——✨ AI 精读按钮 + 流式预览 + 标签 chips

**Files:**
- Modify: `paperlens/src/renderer/components/ReaderView.tsx`
- Test: `paperlens/tests/renderer/ReaderView.test.tsx`（追加 2 测）

**Step 1: 写失败测试** —— 在 `describe('ReaderView', ...)` 内追加：

```tsx
  it('runs AI deep-read: shows streaming preview then refreshes notes', async () => {
    const newNote = { id: 'n2', paperKey: 'P1', content: '## 背景问题…', tags: ['transformer'], createdAt: 2, notionPageId: null }
    const listNotes = vi.fn(async () => [] as any[])
    const deepReadPaper = vi.fn(async (_p: any, onToken: any) => {
      onToken('## 背景问题…', 'content')
      listNotes.mockResolvedValue([newNote])
      return newNote
    })
    ;(window as any).api = { listNotes, deepReadPaper }
    render(<ReaderView paper={paper} />)
    fireEvent.click(screen.getByRole('button', { name: /AI 精读/ }))
    expect(await screen.findByText('## 背景问题…')).toBeInTheDocument()
    expect(deepReadPaper).toHaveBeenCalledWith(paper, expect.any(Function))
    await waitFor(() => expect(listNotes).toHaveBeenCalledTimes(2)) // 挂载 1 次 + 完成后刷新 1 次
  })

  it('renders note tags as chips', async () => {
    const note = { id: 'n1', paperKey: 'P1', content: '要点', tags: ['nlp', 'attention'], createdAt: 1, notionPageId: null }
    ;(window as any).api = { listNotes: vi.fn(async () => [note]) }
    render(<ReaderView paper={paper} />)
    expect(await screen.findByText('nlp')).toBeInTheDocument()
    expect(screen.getByText('attention')).toBeInTheDocument()
  })
```

**Step 2: 运行验证失败**

Run: `npx vitest run tests/renderer/ReaderView.test.tsx`
Expected: 2 新测 FAIL（无 AI 精读按钮、标签未渲染）。原 3 测 PASS。

**Step 3: 实现** —— 修改 `ReaderView.tsx`：

1. state 区追加：
```tsx
  const [deepReading, setDeepReading] = useState(false)
  const [deepReadPreview, setDeepReadPreview] = useState('')
```
2. effect 内（`setError(null)` 后）追加重置：`setDeepReadPreview('')`。
3. `openPdf` 之后追加：
```tsx
  async function deepRead() {
    setError(null)
    setDeepReading(true)
    setDeepReadPreview('')
    try {
      await window.api.deepReadPaper(paper!, (delta, kind) => {
        if (kind !== 'reasoning') setDeepReadPreview(p => p + delta)
      })
      setNotes(await window.api.listNotes(paper!.key))
      setDeepReadPreview('')
    } catch (e) {
      setError('AI 精读失败：' + errMsg(e))
    } finally { setDeepReading(false) }
  }
```
4. summary 分支中 `<h3>学习笔记</h3>` 替换为带按钮的行 + 预览区：
```tsx
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: '8px 0' }}>学习笔记</h3>
            <button onClick={deepRead} disabled={deepReading}>✨ AI 精读</button>
          </div>
          {(deepReading || deepReadPreview) && (
            <div style={{ color: '#999', fontSize: 12, whiteSpace: 'pre-wrap', border: '1px dashed #ddd', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              {deepReadPreview || '正在精读…'}
            </div>
          )}
```
5. 笔记条目 `<div>{n.content}</div>` 之后追加标签 chips：
```tsx
                {n.tags.length > 0 && (
                  <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {n.tags.map(t => (
                      <span key={t} style={{ fontSize: 11, background: '#eef', borderRadius: 4, padding: '1px 6px' }}>{t}</span>
                    ))}
                  </div>
                )}
```

**Step 4: 运行验证通过**

Run: `npx vitest run tests/renderer/ReaderView.test.tsx` → 5 passed。
Run: `npx tsc --noEmit` → exit 0；`npx vitest run` → **69 passed + 1 skipped**。

**Step 5: Commit**
```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/renderer/components/ReaderView.tsx paperlens/tests/renderer/ReaderView.test.tsx
git commit -m "feat: AI deep-read button with streaming preview + note tag chips"
```

---

### Task A7: 全量回归 + 构建 + SMOKE.md 更新

**Files:**
- Modify: `paperlens/docs/SMOKE.md`

**Step 1: 全量验证**

Run: `cd /Users/zhangyixuan06/work/paperlens && npx vitest run` → **69 passed + 1 skipped**。
Run: `npx tsc --noEmit` → exit 0。
Run: `npm run build` → success。
（如本机有 GUI：`npm run e2e:electron` → exit 0，确认 `window.api` 含 `deepReadPaper`。）

**Step 2: SMOKE.md** —— 「步骤」一节追加：

```markdown
8. [ ] 右栏点快捷提问 chip（如「核心贡献」）→ 直接发问并流式回答。
9. [ ] 勾「深思」再提问 → 答案上方先流式显示灰色思维链，再出正式回答（deepseek-reasoner，较慢）。
10. [ ] 中栏点「✨ AI 精读」→ 虚线框内流式预览 → 完成后「学习笔记」出现结构化精读笔记，自动带 2-4 个标签。
11. [ ] 点「存为笔记」保存的对话回复 → 笔记自动带 AI 标签；同步到 Notion 后 Tags 列有值。
```
首段测试计数同步改为 69 项。

**Step 3: Commit**
```bash
cd /Users/zhangyixuan06/work
git add paperlens/docs/SMOKE.md
git commit -m "docs: smoke checklist for AI capabilities (deep-read/prompts/reasoner/tags)"
```

---

## 执行顺序与里程碑

| 里程碑 | Task | 能力 |
|---|---|---|
| M-AI-1 服务层 | A1–A2 | stream kind + 3 纯函数全部单测绿 |
| M-AI-2 接线 | A3–A4 | deepThink/精读/autoTag 全通道就位（tsc+build） |
| M-AI-3 UI | A5–A6 | 四项能力可见可用，69 测试绿 |
| M-AI-4 收尾 | A7 | 回归 + 文档 |

## 给执行者的提醒

- 严格 TDD（A1/A2/A5/A6 红→绿；A3/A4 为胶水，tsc+build+不回归）。
- `ChatMessage` 共享类型不准动；reasoning 只活在 ChatView 本地 `Bubble`。
- `chat:token`/`deepread:token` 是两条独立通道，别合并（精读不进聊天）。
- mock `window.api` 的 streamChat/deepReadPaper 回调调用带 kind 第二参；旧测试的单参回调兼容，勿改其断言语义。
- 失败路径：精读失败走 ReaderView alert；标签失败必须静默回 `[]`。
- 频繁提交，信息用 `feat:`/`docs:` 前缀。
