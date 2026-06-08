# 论文阅读与学习助手 (PaperLens) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个 Electron 桌面应用：从 Zotero（Web API）拉取论文库，在应用内阅读 PDF，与 DeepSeek AI 对话学习论文，并把学习成果同步为 Notion 结构化数据库条目。

**Architecture:** Electron 三进程结构。**主进程（main）** 持有所有密钥并承担全部外部 I/O（Zotero / DeepSeek / Notion HTTP 调用、本地 SQLite、PDF 下载与文本抽取），对外暴露纯函数式的 Service 模块（便于单测）。**渲染进程（renderer）** 用 React + TypeScript 实现 UI（论文库 / 阅读器 / 对话 / 同步），通过类型安全的 IPC（preload 暴露 `window.api`）调用主进程。所有可测试逻辑（API client、上下文构建、数据映射）写成不依赖 Electron 的纯模块，用 Vitest + 注入式 `fetch`/`db` 做 TDD；UI 用 React Testing Library 测交互。

**Tech Stack:** Electron + electron-vite、React 18、TypeScript（严格模式）、Vitest、@testing-library/react、better-sqlite3（主进程本地库）、pdfjs-dist（PDF 渲染 + 文本抽取）、zod（运行时校验 + 类型）、undici/原生 fetch（HTTP）。AI 走 DeepSeek 的 OpenAI 兼容端点（`https://api.deepseek.com`），Notion 走官方 REST API，Zotero 走 Web API v3。

**关键设计约束：**
- 密钥（Zotero API Key + userID、DeepSeek Key、Notion Token + databaseId）**只存在于主进程**，通过 Electron `safeStorage` 加密落盘，renderer 永不接触明文。
- 每个 Service 都接受**注入的依赖**（`fetch`、`db`、时间戳函数），这样单测无需真实网络/磁盘。
- DeepSeek 是纯文本模型，不支持 PDF 原生输入 → 必须先用 pdfjs 抽取论文文本，再做上下文裁剪喂给模型。
- 全程 TDD：先写失败测试，再写最小实现。频繁提交。DRY / YAGNI。

**MVP 边界（YAGNI）：** 单 Zotero 账号；同步方向为「应用 → Notion」单向；对话上下文用「论文全文截断 + 滑动窗口」而非向量检索（RAG 留作未来扩展点）。

---

## 目录结构（最终形态，便于对照）

```
paperlens/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── main/                      # 主进程
│   │   ├── index.ts               # 应用入口、窗口、IPC 注册
│   │   ├── ipc.ts                 # IPC handler 注册（薄封装，调用 services）
│   │   └── services/              # 纯逻辑，单测覆盖
│   │       ├── config-store.ts    # safeStorage 加密配置
│   │       ├── zotero-client.ts   # Zotero Web API
│   │       ├── pdf-service.ts     # PDF 下载 + 文本抽取
│   │       ├── db.ts              # SQLite 初始化与迁移
│   │       ├── notes-repo.ts      # 笔记/会话本地存储
│   │       ├── ai-chat.ts         # DeepSeek 对话 + 上下文构建
│   │       └── notion-sync.ts     # Notion 结构化同步
│   ├── preload/
│   │   └── index.ts               # contextBridge 暴露 window.api
│   ├── renderer/                  # React UI
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api.ts                 # window.api 类型声明
│   │   └── components/
│   │       ├── LibraryView.tsx
│   │       ├── ReaderView.tsx
│   │       ├── ChatView.tsx
│   │       └── SettingsView.tsx
│   └── shared/
│       └── types.ts               # main/renderer 共享类型 + zod schema
└── tests/                         # 与 src 镜像
```

---

## Phase 0：项目脚手架

### Task 0：初始化 Electron + React + TS + Vitest 工程

**Files:**
- Create: `paperlens/package.json`
- Create: `paperlens/electron.vite.config.ts`
- Create: `paperlens/tsconfig.json`
- Create: `paperlens/vitest.config.ts`
- Create: `paperlens/src/shared/types.ts`
- Create: `paperlens/.gitignore`

**Step 1: 创建工程骨架与依赖**

在 `/Users/zhangyixuan06/work` 下创建 `paperlens/` 子目录作为应用根（保留仓库根放 docs/plans）。

`paperlens/package.json`:
```json
{
  "name": "paperlens",
  "version": "0.1.0",
  "description": "论文阅读与学习助手",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "pdfjs-dist": "^4.6.82",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.1",
    "@types/better-sqlite3": "^7.6.11",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^32.1.0",
    "electron-vite": "^2.3.0",
    "jsdom": "^25.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

**Step 2: 配置文件**

`paperlens/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src", "tests"]
}
```

`paperlens/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
  },
  resolve: { alias: { '@shared': new URL('./src/shared', import.meta.url).pathname } },
})
```

`paperlens/electron.vite.config.ts`:
```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { external: ['better-sqlite3'] } } },
  preload: {},
  renderer: { plugins: [react()] },
})
```

`paperlens/.gitignore`:
```
node_modules/
out/
dist/
*.log
.DS_Store
```

`paperlens/src/shared/types.ts`（占位，后续任务填充）:
```ts
// 共享类型与 zod schema 的集中定义。后续 Task 逐步补充。
export {}
```

**Step 3: 安装依赖并验证 toolchain**

Run: `cd paperlens && npm install`
Expected: 安装成功，better-sqlite3 完成原生编译（macOS 需 Xcode CLT）。

Run: `cd paperlens && npx tsc --noEmit`
Expected: 无类型错误（空工程通过）。

Run: `cd paperlens && npx vitest run`
Expected: "No test files found"（退出码可能非 0，属正常，下一步加测试）。

**Step 4: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/package.json paperlens/*.config.ts paperlens/tsconfig.json paperlens/.gitignore paperlens/src/shared/types.ts paperlens/package-lock.json
git commit -m "chore: scaffold electron+react+ts+vitest project"
```

---

## Phase 1：共享类型与 zod schema

### Task 1：定义核心领域类型

**Files:**
- Modify: `paperlens/src/shared/types.ts`
- Test: `paperlens/tests/shared/types.test.ts`

**Step 1: 写失败测试**

`paperlens/tests/shared/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PaperSchema, NoteSchema, AppConfigSchema } from '@shared/types'

describe('shared schemas', () => {
  it('parses a valid paper', () => {
    const p = PaperSchema.parse({
      key: 'ABC123',
      title: 'Attention Is All You Need',
      authors: ['Vaswani'],
      year: 2017,
      abstract: 'We propose...',
      attachmentKey: 'PDFKEY',
    })
    expect(p.title).toContain('Attention')
  })

  it('rejects a paper without a key', () => {
    expect(() => PaperSchema.parse({ title: 'x' })).toThrow()
  })

  it('parses a note with required fields', () => {
    const n = NoteSchema.parse({
      id: 'n1', paperKey: 'ABC123', content: '核心贡献是自注意力',
      tags: ['transformer'], createdAt: 1700000000000,
    })
    expect(n.tags).toEqual(['transformer'])
  })

  it('validates app config with empty defaults', () => {
    const c = AppConfigSchema.parse({})
    expect(c.zoteroUserId).toBe('')
    expect(c.deepseekModel).toBe('deepseek-chat')
  })
})
```

**Step 2: 运行测试验证失败**

Run: `cd paperlens && npx vitest run tests/shared/types.test.ts`
Expected: FAIL（`PaperSchema` 未导出）。

**Step 3: 最小实现**

`paperlens/src/shared/types.ts`:
```ts
import { z } from 'zod'

export const PaperSchema = z.object({
  key: z.string().min(1),
  title: z.string(),
  authors: z.array(z.string()).default([]),
  year: z.number().nullable().default(null),
  abstract: z.string().default(''),
  attachmentKey: z.string().nullable().default(null),
})
export type Paper = z.infer<typeof PaperSchema>

export const NoteSchema = z.object({
  id: z.string().min(1),
  paperKey: z.string().min(1),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  createdAt: z.number(),
  notionPageId: z.string().nullable().default(null),
})
export type Note = z.infer<typeof NoteSchema>

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const AppConfigSchema = z.object({
  zoteroApiKey: z.string().default(''),
  zoteroUserId: z.string().default(''),
  deepseekApiKey: z.string().default(''),
  deepseekModel: z.string().default('deepseek-chat'),
  notionToken: z.string().default(''),
  notionDatabaseId: z.string().default(''),
})
export type AppConfig = z.infer<typeof AppConfigSchema>
```

**Step 4: 运行测试验证通过**

Run: `cd paperlens && npx vitest run tests/shared/types.test.ts`
Expected: PASS（4 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/shared/types.ts paperlens/tests/shared/types.test.ts
git commit -m "feat: add shared domain schemas (Paper/Note/ChatMessage/AppConfig)"
```

---

## Phase 2：Zotero Web API 客户端

> 参考：Zotero Web API v3。基址 `https://api.zotero.org`。读取用户库：`GET /users/{userId}/items?...`，鉴权头 `Zotero-API-Key`。附件 PDF 下载：`GET /users/{userId}/items/{itemKey}/file`（302 到文件）。返回头 `Total-Results` 用于分页。

### Task 2：Zotero 客户端 —— 列出论文条目

**Files:**
- Create: `paperlens/src/main/services/zotero-client.ts`
- Test: `paperlens/tests/main/zotero-client.test.ts`

**Step 1: 写失败测试**（注入 fake fetch，不触网）

`paperlens/tests/main/zotero-client.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createZoteroClient } from '../../src/main/services/zotero-client'

const sampleItem = (key: string, title: string, type = 'journalArticle') => ({
  key,
  data: {
    key, itemType: type, title,
    creators: [{ creatorType: 'author', lastName: 'Vaswani', firstName: 'A' }],
    date: '2017-06-12', abstractNote: 'We propose the Transformer',
  },
})

describe('zotero-client.listPapers', () => {
  it('maps Zotero items to Paper[] and filters out attachments', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify([
        sampleItem('AAA', 'Attention Is All You Need'),
        { key: 'ATT1', data: { key: 'ATT1', itemType: 'attachment', title: 'x.pdf' } },
      ]), { status: 200, headers: { 'Total-Results': '2' } })
    )
    const client = createZoteroClient({ apiKey: 'k', userId: '123', fetch })
    const papers = await client.listPapers()

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]
    expect(url).toContain('/users/123/items')
    expect((init.headers as Record<string, string>)['Zotero-API-Key']).toBe('k')
    expect(papers).toHaveLength(1)
    expect(papers[0]).toMatchObject({ key: 'AAA', title: 'Attention Is All You Need', year: 2017 })
    expect(papers[0].authors).toEqual(['A Vaswani'])
  })

  it('throws a helpful error on 403', async () => {
    const fetch = vi.fn(async () => new Response('Forbidden', { status: 403 }))
    const client = createZoteroClient({ apiKey: 'bad', userId: '123', fetch })
    await expect(client.listPapers()).rejects.toThrow(/Zotero.*403/)
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/zotero-client.test.ts`
Expected: FAIL（模块不存在）。

**Step 3: 最小实现**

`paperlens/src/main/services/zotero-client.ts`:
```ts
import type { Paper } from '@shared/types'

export interface ZoteroDeps {
  apiKey: string
  userId: string
  fetch: typeof fetch
  baseUrl?: string
}

interface ZoteroCreator { creatorType: string; firstName?: string; lastName?: string; name?: string }
interface ZoteroItemData {
  key: string; itemType: string; title?: string
  creators?: ZoteroCreator[]; date?: string; abstractNote?: string
}
interface ZoteroItem { key: string; data: ZoteroItemData }

const PAPER_TYPES = new Set([
  'journalArticle', 'conferencePaper', 'preprint', 'book', 'bookSection', 'report', 'thesis',
])

function authorName(c: ZoteroCreator): string {
  if (c.name) return c.name
  return [c.firstName, c.lastName].filter(Boolean).join(' ')
}

function yearFromDate(date?: string): number | null {
  if (!date) return null
  const m = date.match(/\d{4}/)
  return m ? Number(m[0]) : null
}

function toPaper(item: ZoteroItem): Paper {
  const d = item.data
  return {
    key: d.key,
    title: d.title ?? '(无标题)',
    authors: (d.creators ?? []).filter(c => c.creatorType === 'author').map(authorName),
    year: yearFromDate(d.date),
    abstract: d.abstractNote ?? '',
    attachmentKey: null,
  }
}

export function createZoteroClient(deps: ZoteroDeps) {
  const base = deps.baseUrl ?? 'https://api.zotero.org'
  const headers = { 'Zotero-API-Key': deps.apiKey, 'Zotero-API-Version': '3' }

  async function listPapers(limit = 100): Promise<Paper[]> {
    const url = `${base}/users/${deps.userId}/items?limit=${limit}&sort=dateModified&direction=desc`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero listPapers failed: ${res.status}`)
    const items = (await res.json()) as ZoteroItem[]
    return items.filter(i => PAPER_TYPES.has(i.data.itemType)).map(toPaper)
  }

  return { listPapers }
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/zotero-client.test.ts`
Expected: PASS（2 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/zotero-client.ts paperlens/tests/main/zotero-client.test.ts
git commit -m "feat: zotero web api client - listPapers"
```

---

### Task 3：Zotero 客户端 —— 查找 PDF 附件并下载

**Files:**
- Modify: `paperlens/src/main/services/zotero-client.ts`
- Test: `paperlens/tests/main/zotero-client.test.ts`（追加）

**Step 1: 写失败测试**

在 `tests/main/zotero-client.test.ts` 追加：
```ts
describe('zotero-client.findPdfAttachment', () => {
  it('returns the first PDF child attachment key', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify([
        { key: 'C1', data: { key: 'C1', itemType: 'attachment', contentType: 'text/html' } },
        { key: 'C2', data: { key: 'C2', itemType: 'attachment', contentType: 'application/pdf' } },
      ]), { status: 200 })
    )
    const client = createZoteroClient({ apiKey: 'k', userId: '1', fetch })
    const key = await client.findPdfAttachment('PARENT')
    expect(fetch.mock.calls[0][0]).toContain('/items/PARENT/children')
    expect(key).toBe('C2')
  })

  it('returns null when no pdf child exists', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    const client = createZoteroClient({ apiKey: 'k', userId: '1', fetch })
    expect(await client.findPdfAttachment('PARENT')).toBeNull()
  })
})

describe('zotero-client.downloadAttachment', () => {
  it('fetches the file endpoint and returns bytes', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
    const fetch = vi.fn(async () => new Response(bytes, { status: 200 }))
    const client = createZoteroClient({ apiKey: 'k', userId: '1', fetch })
    const buf = await client.downloadAttachment('C2')
    expect(fetch.mock.calls[0][0]).toContain('/items/C2/file')
    expect(new Uint8Array(buf).slice(0, 4)).toEqual(bytes)
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/zotero-client.test.ts`
Expected: FAIL（方法未定义）。

**Step 3: 最小实现** —— 在 `createZoteroClient` 内追加并导出：
```ts
  async function findPdfAttachment(parentKey: string): Promise<string | null> {
    const url = `${base}/users/${deps.userId}/items/${parentKey}/children`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero children failed: ${res.status}`)
    const children = (await res.json()) as Array<{ data: { key: string; itemType: string; contentType?: string } }>
    const pdf = children.find(c => c.data.itemType === 'attachment' && c.data.contentType === 'application/pdf')
    return pdf ? pdf.data.key : null
  }

  async function downloadAttachment(attachmentKey: string): Promise<ArrayBuffer> {
    const url = `${base}/users/${deps.userId}/items/${attachmentKey}/file`
    const res = await deps.fetch(url, { headers })
    if (!res.ok) throw new Error(`Zotero file download failed: ${res.status}`)
    return res.arrayBuffer()
  }

  return { listPapers, findPdfAttachment, downloadAttachment }
```
（把原 `return { listPapers }` 替换为上面这行。）

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/zotero-client.test.ts`
Expected: PASS（全部 5 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/zotero-client.ts paperlens/tests/main/zotero-client.test.ts
git commit -m "feat: zotero client - findPdfAttachment + downloadAttachment"
```

---

## Phase 3：PDF 文本抽取服务

> pdfjs 抽取纯文本供 AI 上下文使用；渲染交给 renderer（Task 13）。本任务只测「字节 → 文本」，pdfjs 的 `getDocument` 通过依赖注入替换为 fake，避免在 node 测试里跑真实解析。

### Task 4：PDF 文本抽取（纯函数 + 缓存）

**Files:**
- Create: `paperlens/src/main/services/pdf-service.ts`
- Test: `paperlens/tests/main/pdf-service.test.ts`

**Step 1: 写失败测试**

`paperlens/tests/main/pdf-service.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { extractPdfText } from '../../src/main/services/pdf-service'

// 伪造 pdfjs：2 页，每页若干 text item
function fakeLoader() {
  const page = (strs: string[]) => ({
    getTextContent: async () => ({ items: strs.map(s => ({ str: s })) }),
  })
  return vi.fn(async (_data: Uint8Array) => ({
    numPages: 2,
    getPage: async (n: number) =>
      n === 1 ? page(['Hello', 'world']) : page(['second', 'page']),
  }))
}

describe('extractPdfText', () => {
  it('joins text items across pages with spaces and newlines', async () => {
    const text = await extractPdfText(new Uint8Array([1, 2, 3]), { loadDocument: fakeLoader() })
    expect(text).toBe('Hello world\nsecond page')
  })

  it('caps output at maxChars', async () => {
    const text = await extractPdfText(new Uint8Array([1]), {
      loadDocument: fakeLoader(), maxChars: 5,
    })
    expect(text.length).toBeLessThanOrEqual(5)
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/pdf-service.test.ts`
Expected: FAIL（模块不存在）。

**Step 3: 最小实现**

`paperlens/src/main/services/pdf-service.ts`:
```ts
interface FakePage { getTextContent(): Promise<{ items: Array<{ str: string }> }> }
interface FakeDoc { numPages: number; getPage(n: number): Promise<FakePage> }

export interface ExtractOptions {
  loadDocument?: (data: Uint8Array) => Promise<FakeDoc>
  maxChars?: number
}

// 真实加载器：延迟引入 pdfjs，避免污染单测环境
async function realLoadDocument(data: Uint8Array): Promise<FakeDoc> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data })
  return (await task.promise) as unknown as FakeDoc
}

export async function extractPdfText(bytes: Uint8Array, opts: ExtractOptions = {}): Promise<string> {
  const load = opts.loadDocument ?? realLoadDocument
  const maxChars = opts.maxChars ?? 120_000
  const doc = await load(bytes)
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map(it => it.str).join(' '))
    if (pages.join('\n').length >= maxChars) break
  }
  return pages.join('\n').slice(0, maxChars)
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/pdf-service.test.ts`
Expected: PASS（2 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/pdf-service.ts paperlens/tests/main/pdf-service.test.ts
git commit -m "feat: pdf text extraction service with injectable loader"
```

---

## Phase 4：本地存储（SQLite）

### Task 5：数据库初始化与迁移

**Files:**
- Create: `paperlens/src/main/services/db.ts`
- Test: `paperlens/tests/main/db.test.ts`

**Step 1: 写失败测试**（用内存库 `:memory:`）

`paperlens/tests/main/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'

describe('db.migrate', () => {
  it('creates notes and pdf_cache tables', () => {
    const db = new Database(':memory:')
    migrate(db)
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name)
    expect(tables).toContain('notes')
    expect(tables).toContain('pdf_cache')
  })

  it('is idempotent (safe to run twice)', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(() => migrate(db)).not.toThrow()
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/db.test.ts`
Expected: FAIL（`migrate` 未定义）。

**Step 3: 最小实现**

`paperlens/src/main/services/db.ts`:
```ts
import type DatabaseType from 'better-sqlite3'

export function migrate(db: DatabaseType.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      paper_key TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      notion_page_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notes_paper ON notes(paper_key);

    CREATE TABLE IF NOT EXISTS pdf_cache (
      attachment_key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );
  `)
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/db.test.ts`
Expected: PASS（2 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/db.ts paperlens/tests/main/db.test.ts
git commit -m "feat: sqlite migration for notes and pdf_cache"
```

---

### Task 6：笔记仓库（NotesRepo）

**Files:**
- Create: `paperlens/src/main/services/notes-repo.ts`
- Test: `paperlens/tests/main/notes-repo.test.ts`

**Step 1: 写失败测试**

`paperlens/tests/main/notes-repo.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/services/db'
import { createNotesRepo } from '../../src/main/services/notes-repo'

function repo() {
  const db = new Database(':memory:')
  migrate(db)
  let seq = 0
  return createNotesRepo({ db, now: () => 1700000000000, genId: () => `id-${++seq}` })
}

describe('NotesRepo', () => {
  it('saves and lists notes for a paper', () => {
    const r = repo()
    r.add({ paperKey: 'P1', content: '自注意力', tags: ['nlp'] })
    r.add({ paperKey: 'P1', content: '位置编码', tags: [] })
    r.add({ paperKey: 'P2', content: '无关', tags: [] })
    const list = r.listByPaper('P1')
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ paperKey: 'P1', content: '自注意力', tags: ['nlp'] })
    expect(list[0].id).toBe('id-1')
  })

  it('marks a note as synced with a notion page id', () => {
    const r = repo()
    const note = r.add({ paperKey: 'P1', content: 'x', tags: [] })
    r.markSynced(note.id, 'notion-123')
    const [reloaded] = r.listByPaper('P1')
    expect(reloaded.notionPageId).toBe('notion-123')
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/notes-repo.test.ts`
Expected: FAIL。

**Step 3: 最小实现**

`paperlens/src/main/services/notes-repo.ts`:
```ts
import type DatabaseType from 'better-sqlite3'
import type { Note } from '@shared/types'

export interface NotesRepoDeps {
  db: DatabaseType.Database
  now: () => number
  genId: () => string
}

interface NoteRow {
  id: string; paper_key: string; content: string
  tags: string; created_at: number; notion_page_id: string | null
}

function rowToNote(r: NoteRow): Note {
  return {
    id: r.id, paperKey: r.paper_key, content: r.content,
    tags: JSON.parse(r.tags), createdAt: r.created_at, notionPageId: r.notion_page_id,
  }
}

export function createNotesRepo(deps: NotesRepoDeps) {
  const { db } = deps

  function add(input: { paperKey: string; content: string; tags: string[] }): Note {
    const note: Note = {
      id: deps.genId(), paperKey: input.paperKey, content: input.content,
      tags: input.tags, createdAt: deps.now(), notionPageId: null,
    }
    db.prepare(
      `INSERT INTO notes (id, paper_key, content, tags, created_at, notion_page_id)
       VALUES (@id, @paperKey, @content, @tags, @createdAt, NULL)`
    ).run({ ...note, tags: JSON.stringify(note.tags) })
    return note
  }

  function listByPaper(paperKey: string): Note[] {
    const rows = db.prepare(
      'SELECT * FROM notes WHERE paper_key = ? ORDER BY created_at ASC'
    ).all(paperKey) as NoteRow[]
    return rows.map(rowToNote)
  }

  function markSynced(id: string, notionPageId: string): void {
    db.prepare('UPDATE notes SET notion_page_id = ? WHERE id = ?').run(notionPageId, id)
  }

  return { add, listByPaper, markSynced }
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/notes-repo.test.ts`
Expected: PASS（2 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/notes-repo.ts paperlens/tests/main/notes-repo.test.ts
git commit -m "feat: notes repository over sqlite"
```

---

## Phase 5：DeepSeek AI 对话服务

> DeepSeek 提供 OpenAI 兼容端点：`POST https://api.deepseek.com/chat/completions`，鉴权 `Authorization: Bearer <key>`，body 含 `model`、`messages`、`stream`。本阶段拆成两个可测单元：**上下文构建（纯函数）** 与 **请求/响应（注入 fetch）**。

### Task 7：对话上下文构建（纯函数）

**Files:**
- Create: `paperlens/src/main/services/ai-chat.ts`
- Test: `paperlens/tests/main/ai-context.test.ts`

**Step 1: 写失败测试**

`paperlens/tests/main/ai-context.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildMessages } from '../../src/main/services/ai-chat'
import type { Paper } from '@shared/types'

const paper: Paper = {
  key: 'P1', title: 'Transformer', authors: ['Vaswani'], year: 2017,
  abstract: 'attention', attachmentKey: null,
}

describe('buildMessages', () => {
  it('puts a system prompt with paper metadata + truncated full text first', () => {
    const msgs = buildMessages({
      paper, paperText: 'X'.repeat(1000), history: [], userInput: '这篇论文讲了什么？',
      maxContextChars: 100,
    })
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('Transformer')
    expect(msgs[0].content).toContain('Vaswani')
    // 全文被截断到 maxContextChars
    expect(msgs[0].content).toContain('X'.repeat(100))
    expect(msgs[0].content).not.toContain('X'.repeat(101))
    expect(msgs.at(-1)).toEqual({ role: 'user', content: '这篇论文讲了什么？' })
  })

  it('keeps prior conversation history between system and new input', () => {
    const msgs = buildMessages({
      paper, paperText: 'abc',
      history: [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '第一答' }],
      userInput: '第二问', maxContextChars: 1000,
    })
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/ai-context.test.ts`
Expected: FAIL。

**Step 3: 最小实现**

`paperlens/src/main/services/ai-chat.ts`:
```ts
import type { Paper, ChatMessage } from '@shared/types'

export interface BuildMessagesInput {
  paper: Paper
  paperText: string
  history: ChatMessage[]
  userInput: string
  maxContextChars?: number
}

export function buildMessages(input: BuildMessagesInput): ChatMessage[] {
  const max = input.maxContextChars ?? 60_000
  const text = input.paperText.slice(0, max)
  const meta = `标题：${input.paper.title}\n作者：${input.paper.authors.join(', ')}\n年份：${input.paper.year ?? '未知'}`
  const system: ChatMessage = {
    role: 'system',
    content:
      `你是一个严谨的论文学习助手。基于以下论文与用户对话，帮助用户深入理解。` +
      `只依据论文内容作答，不确定时明确说明。\n\n【论文元数据】\n${meta}\n\n【论文正文（可能截断）】\n${text}`,
  }
  return [system, ...input.history, { role: 'user', content: input.userInput }]
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/ai-context.test.ts`
Expected: PASS（2 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/ai-chat.ts paperlens/tests/main/ai-context.test.ts
git commit -m "feat: build chat context messages from paper + history"
```

---

### Task 8：DeepSeek 请求（非流式，注入 fetch）

**Files:**
- Modify: `paperlens/src/main/services/ai-chat.ts`
- Test: `paperlens/tests/main/ai-chat.test.ts`

**Step 1: 写失败测试**

`paperlens/tests/main/ai-chat.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createAiChat } from '../../src/main/services/ai-chat'
import type { ChatMessage } from '@shared/types'

describe('createAiChat.complete', () => {
  it('posts to deepseek with bearer auth and returns assistant text', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '这篇论文提出了Transformer。' } }],
      }), { status: 200 })
    )
    const chat = createAiChat({ apiKey: 'sk-x', model: 'deepseek-chat', fetch })
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const reply = await chat.complete(msgs)

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect((init.headers as any)['Authorization']).toBe('Bearer sk-x')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('deepseek-chat')
    expect(body.messages).toEqual(msgs)
    expect(reply).toBe('这篇论文提出了Transformer。')
  })

  it('throws on non-200', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 401 }))
    const chat = createAiChat({ apiKey: 'bad', model: 'deepseek-chat', fetch })
    await expect(chat.complete([{ role: 'user', content: 'x' }])).rejects.toThrow(/DeepSeek.*401/)
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/ai-chat.test.ts`
Expected: FAIL（`createAiChat` 未定义）。

**Step 3: 最小实现** —— 在 `ai-chat.ts` 追加：
```ts
export interface AiChatDeps {
  apiKey: string
  model: string
  fetch: typeof fetch
  baseUrl?: string
}

export function createAiChat(deps: AiChatDeps) {
  const url = `${deps.baseUrl ?? 'https://api.deepseek.com'}/chat/completions`

  async function complete(messages: ChatMessage[]): Promise<string> {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.apiKey}` },
      body: JSON.stringify({ model: deps.model, messages, stream: false }),
    })
    if (!res.ok) throw new Error(`DeepSeek request failed: ${res.status}`)
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content ?? ''
  }

  return { complete }
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/ai-chat.test.ts`
Expected: PASS（2 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/ai-chat.ts paperlens/tests/main/ai-chat.test.ts
git commit -m "feat: deepseek chat completion client"
```

---

## Phase 6：Notion 结构化同步

> Notion REST API：`POST https://api.notion.com/v1/pages`，header `Authorization: Bearer <token>`、`Notion-Version: 2022-06-28`。父级为 `database_id`。属性映射到数据库的列（Title / Rich text / Multi-select / Number）。已同步过的笔记用 `PATCH /v1/pages/{id}` 更新。

### Task 9：Note → Notion page payload 映射（纯函数）

**Files:**
- Create: `paperlens/src/main/services/notion-sync.ts`
- Test: `paperlens/tests/main/notion-mapping.test.ts`

**Step 1: 写失败测试**

`paperlens/tests/main/notion-mapping.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { noteToNotionPage } from '../../src/main/services/notion-sync'
import type { Note, Paper } from '@shared/types'

const paper: Paper = {
  key: 'P1', title: 'Transformer', authors: ['Vaswani', 'Shazeer'], year: 2017,
  abstract: 'a', attachmentKey: null,
}
const note: Note = {
  id: 'n1', paperKey: 'P1', content: '核心是自注意力机制', tags: ['nlp', 'attention'],
  createdAt: 1700000000000, notionPageId: null,
}

describe('noteToNotionPage', () => {
  it('maps paper + note into a database page with typed properties', () => {
    const page = noteToNotionPage(note, paper, 'db-123')
    expect(page.parent).toEqual({ database_id: 'db-123' })
    expect(page.properties.Title.title[0].text.content).toBe('Transformer')
    expect(page.properties.Authors.rich_text[0].text.content).toBe('Vaswani, Shazeer')
    expect(page.properties.Year.number).toBe(2017)
    expect(page.properties.Tags.multi_select.map((t: any) => t.name)).toEqual(['nlp', 'attention'])
    // 笔记正文进入页面 body（children paragraph）
    expect(page.children[0].paragraph.rich_text[0].text.content).toBe('核心是自注意力机制')
  })

  it('omits Year when paper.year is null', () => {
    const page = noteToNotionPage(note, { ...paper, year: null }, 'db-123')
    expect(page.properties.Year).toBeUndefined()
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/notion-mapping.test.ts`
Expected: FAIL。

**Step 3: 最小实现**

`paperlens/src/main/services/notion-sync.ts`:
```ts
import type { Note, Paper } from '@shared/types'

const txt = (content: string) => [{ text: { content } }]

export function noteToNotionPage(note: Note, paper: Paper, databaseId: string) {
  const properties: Record<string, unknown> = {
    Title: { title: txt(paper.title) },
    Authors: { rich_text: txt(paper.authors.join(', ')) },
    Tags: { multi_select: note.tags.map(name => ({ name })) },
  }
  if (paper.year !== null) properties.Year = { number: paper.year }

  return {
    parent: { database_id: databaseId },
    properties,
    children: [
      { object: 'block', type: 'paragraph', paragraph: { rich_text: txt(note.content) } },
    ],
  }
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/notion-mapping.test.ts`
Expected: PASS（2 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/notion-sync.ts paperlens/tests/main/notion-mapping.test.ts
git commit -m "feat: map note+paper to notion page payload"
```

---

### Task 10：Notion 同步客户端（创建/更新页面）

**Files:**
- Modify: `paperlens/src/main/services/notion-sync.ts`
- Test: `paperlens/tests/main/notion-sync.test.ts`

**Step 1: 写失败测试**

`paperlens/tests/main/notion-sync.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createNotionSync } from '../../src/main/services/notion-sync'
import type { Note, Paper } from '@shared/types'

const paper: Paper = { key: 'P1', title: 'T', authors: ['A'], year: 2020, abstract: '', attachmentKey: null }
const note: Note = { id: 'n1', paperKey: 'P1', content: 'c', tags: [], createdAt: 1, notionPageId: null }

describe('createNotionSync.sync', () => {
  it('creates a new page when note has no notionPageId', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'new-page-1' }), { status: 200 })
    )
    const sync = createNotionSync({ token: 't', databaseId: 'db', fetch })
    const pageId = await sync.sync(note, paper)

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/pages')
    expect(init.method).toBe('POST')
    expect((init.headers as any)['Notion-Version']).toBe('2022-06-28')
    expect((init.headers as any)['Authorization']).toBe('Bearer t')
    expect(pageId).toBe('new-page-1')
  })

  it('patches existing page when note already synced', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'p9' }), { status: 200 }))
    const sync = createNotionSync({ token: 't', databaseId: 'db', fetch })
    await sync.sync({ ...note, notionPageId: 'p9' }, paper)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/pages/p9')
    expect(init.method).toBe('PATCH')
  })

  it('throws with notion error detail on failure', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'invalid db' }), { status: 400 })
    )
    const sync = createNotionSync({ token: 't', databaseId: 'db', fetch })
    await expect(sync.sync(note, paper)).rejects.toThrow(/Notion.*400.*invalid db/)
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/notion-sync.test.ts`
Expected: FAIL。

**Step 3: 最小实现** —— 在 `notion-sync.ts` 追加：
```ts
export interface NotionSyncDeps {
  token: string
  databaseId: string
  fetch: typeof fetch
  baseUrl?: string
}

export function createNotionSync(deps: NotionSyncDeps) {
  const base = deps.baseUrl ?? 'https://api.notion.com'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${deps.token}`,
    'Notion-Version': '2022-06-28',
  }

  // 返回新建/更新后的 page id
  async function sync(note: Note, paper: Paper): Promise<string> {
    const page = noteToNotionPage(note, paper, deps.databaseId)
    const isUpdate = Boolean(note.notionPageId)
    const url = isUpdate ? `${base}/v1/pages/${note.notionPageId}` : `${base}/v1/pages`
    // 更新时只改 properties（Notion PATCH 不接受 parent/children 重写 body）
    const body = isUpdate ? { properties: page.properties } : page
    const res = await deps.fetch(url, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { id?: string; message?: string }
    if (!res.ok) throw new Error(`Notion sync failed: ${res.status} ${data.message ?? ''}`.trim())
    return data.id as string
  }

  return { sync }
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/notion-sync.test.ts`
Expected: PASS（3 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/notion-sync.ts paperlens/tests/main/notion-sync.test.ts
git commit -m "feat: notion sync client (create/update page)"
```

---

## Phase 7：加密配置存储

### Task 11：ConfigStore（safeStorage + 文件，注入式）

**Files:**
- Create: `paperlens/src/main/services/config-store.ts`
- Test: `paperlens/tests/main/config-store.test.ts`

**Step 1: 写失败测试**（注入 fake crypto + fake fs，不依赖 Electron）

`paperlens/tests/main/config-store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createConfigStore } from '../../src/main/services/config-store'

function fakeBackend() {
  let stored: string | null = null
  return {
    fs: {
      readFileSync: () => { if (stored === null) throw new Error('ENOENT'); return stored },
      writeFileSync: (_p: string, data: string) => { stored = data },
      existsSync: () => stored !== null,
    },
    // 假加密：base64，便于断言「不是明文」
    crypto: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s).toString('base64'),
      decryptString: (b: string) => Buffer.from(b, 'base64').toString('utf8'),
    },
  }
}

describe('ConfigStore', () => {
  it('returns schema defaults when nothing saved', () => {
    const { fs, crypto } = fakeBackend()
    const store = createConfigStore({ filePath: '/x', fs, crypto })
    expect(store.get().deepseekModel).toBe('deepseek-chat')
    expect(store.get().zoteroApiKey).toBe('')
  })

  it('persists encrypted and round-trips on reload', () => {
    const backend = fakeBackend()
    const store = createConfigStore({ filePath: '/x', fs: backend.fs, crypto: backend.crypto })
    store.set({ zoteroApiKey: 'secret', zoteroUserId: '42' })

    // 落盘内容不是明文
    const raw = backend.fs.readFileSync()
    expect(raw).not.toContain('secret')

    // 新实例读回
    const store2 = createConfigStore({ filePath: '/x', fs: backend.fs, crypto: backend.crypto })
    expect(store2.get().zoteroApiKey).toBe('secret')
    expect(store2.get().zoteroUserId).toBe('42')
    expect(store2.get().deepseekModel).toBe('deepseek-chat') // 未设置项保留默认
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/main/config-store.test.ts`
Expected: FAIL。

**Step 3: 最小实现**

`paperlens/src/main/services/config-store.ts`:
```ts
import { AppConfigSchema, type AppConfig } from '@shared/types'

export interface ConfigCrypto {
  isEncryptionAvailable(): boolean
  encryptString(s: string): string
  decryptString(b: string): string
}
export interface ConfigFs {
  readFileSync(): string
  writeFileSync(path: string, data: string): void
  existsSync(): boolean
}
export interface ConfigStoreDeps {
  filePath: string
  fs: ConfigFs
  crypto: ConfigCrypto
}

export function createConfigStore(deps: ConfigStoreDeps) {
  function load(): AppConfig {
    if (!deps.fs.existsSync()) return AppConfigSchema.parse({})
    try {
      const raw = deps.fs.readFileSync()
      const json = deps.crypto.isEncryptionAvailable() ? deps.crypto.decryptString(raw) : raw
      return AppConfigSchema.parse(JSON.parse(json))
    } catch {
      return AppConfigSchema.parse({})
    }
  }

  let current = load()

  function get(): AppConfig {
    return current
  }

  function set(patch: Partial<AppConfig>): AppConfig {
    current = AppConfigSchema.parse({ ...current, ...patch })
    const json = JSON.stringify(current)
    const data = deps.crypto.isEncryptionAvailable() ? deps.crypto.encryptString(json) : json
    deps.fs.writeFileSync(deps.filePath, data)
    return current
  }

  return { get, set }
}
```

> 注：真实接线时 `crypto` 用 Electron `safeStorage`（`encryptString` 返回 Buffer，需 `.toString('base64')` 适配本接口），`fs` 用 node `fs` 读写 `app.getPath('userData')/config.enc`。这层适配在 Task 12 完成。

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/main/config-store.test.ts`
Expected: PASS（2 个测试）。

**Step 5: 全量回归**

Run: `cd paperlens && npx vitest run`
Expected: 全部 services 测试 PASS。

**Step 6: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/services/config-store.ts paperlens/tests/main/config-store.test.ts
git commit -m "feat: encrypted config store with injectable crypto/fs"
```

---

## Phase 8：主进程接线与 IPC

> 本阶段把纯 Service 接到真实 Electron。这部分难以单测（依赖 Electron 运行时），**靠类型检查 + 手动冒烟**保障，测试在 Task 18 端到端补。

### Task 12：主进程入口 + 依赖装配

**Files:**
- Create: `paperlens/src/main/index.ts`
- Create: `paperlens/src/main/ipc.ts`
- Create: `paperlens/src/main/container.ts`

**Step 1: 装配容器（把真实依赖注入 Service）**

`paperlens/src/main/container.ts`:
```ts
import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { migrate } from './services/db'
import { createConfigStore } from './services/config-store'
import { createNotesRepo } from './services/notes-repo'
import { createZoteroClient } from './services/zotero-client'
import { createAiChat } from './services/ai-chat'
import { createNotionSync } from './services/notion-sync'

export function createContainer() {
  const userData = app.getPath('userData')
  const configPath = join(userData, 'config.enc')

  const configStore = createConfigStore({
    filePath: configPath,
    fs: {
      existsSync: () => fs.existsSync(configPath),
      readFileSync: () => fs.readFileSync(configPath, 'utf8'),
      writeFileSync: (p, d) => fs.writeFileSync(p, d, 'utf8'),
    },
    crypto: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s) => safeStorage.encryptString(s).toString('base64'),
      decryptString: (b) => safeStorage.decryptString(Buffer.from(b, 'base64')),
    },
  })

  const db = new Database(join(userData, 'paperlens.db'))
  migrate(db)
  const notesRepo = createNotesRepo({
    db,
    now: () => Date.now(),
    genId: () => globalThis.crypto.randomUUID(),
  })

  // 工厂：按当前配置即时构造外部客户端（密钥可能随时被用户更新）
  const cfg = () => configStore.get()
  const zotero = () => createZoteroClient({ apiKey: cfg().zoteroApiKey, userId: cfg().zoteroUserId, fetch })
  const ai = () => createAiChat({ apiKey: cfg().deepseekApiKey, model: cfg().deepseekModel, fetch })
  const notion = () => createNotionSync({ token: cfg().notionToken, databaseId: cfg().notionDatabaseId, fetch })

  return { configStore, db, notesRepo, zotero, ai, notion }
}
export type Container = ReturnType<typeof createContainer>
```

**Step 2: IPC handler（薄封装，含 PDF 文本缓存逻辑）**

`paperlens/src/main/ipc.ts`:
```ts
import { ipcMain } from 'electron'
import type { Container } from './container'
import { extractPdfText } from './services/pdf-service'
import { buildMessages } from './services/ai-chat'
import type { AppConfig, ChatMessage, Paper } from '@shared/types'

export function registerIpc(c: Container) {
  ipcMain.handle('config:get', () => c.configStore.get())
  ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => c.configStore.set(patch))

  ipcMain.handle('zotero:list', () => c.zotero().listPapers())

  // 返回论文全文（带 sqlite 缓存）
  ipcMain.handle('paper:text', async (_e, paper: Paper): Promise<string> => {
    const z = c.zotero()
    const attKey = paper.attachmentKey ?? (await z.findPdfAttachment(paper.key))
    if (!attKey) return ''
    const cached = c.db.prepare('SELECT text FROM pdf_cache WHERE attachment_key = ?').get(attKey) as { text: string } | undefined
    if (cached) return cached.text
    const bytes = new Uint8Array(await z.downloadAttachment(attKey))
    const text = await extractPdfText(bytes)
    c.db.prepare('INSERT OR REPLACE INTO pdf_cache (attachment_key, text, cached_at) VALUES (?, ?, ?)')
      .run(attKey, text, Date.now())
    return text
  })

  ipcMain.handle('chat:send', async (_e, args: { paper: Paper; paperText: string; history: ChatMessage[]; input: string }) => {
    const messages = buildMessages({ paper: args.paper, paperText: args.paperText, history: args.history, userInput: args.input })
    return c.ai().complete(messages)
  })

  ipcMain.handle('notes:add', (_e, n: { paperKey: string; content: string; tags: string[] }) => c.notesRepo.add(n))
  ipcMain.handle('notes:list', (_e, paperKey: string) => c.notesRepo.listByPaper(paperKey))

  ipcMain.handle('notes:sync', async (_e, args: { noteId: string; paper: Paper }) => {
    const note = c.notesRepo.listByPaper(args.paper.key).find(n => n.id === args.noteId)
    if (!note) throw new Error('note not found')
    const pageId = await c.notion().sync(note, args.paper)
    c.notesRepo.markSynced(note.id, pageId)
    return pageId
  })
}
```

**Step 3: 应用入口**

`paperlens/src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createContainer } from './container'
import { registerIpc } from './ipc'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerIpc(createContainer())
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

**Step 4: 类型检查**

Run: `cd paperlens && npx tsc --noEmit`
Expected: 无错误。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/index.ts paperlens/src/main/ipc.ts paperlens/src/main/container.ts
git commit -m "feat: main process wiring - container + ipc handlers"
```

---

### Task 13：Preload 桥接（类型安全 window.api）

**Files:**
- Create: `paperlens/src/preload/index.ts`
- Create: `paperlens/src/renderer/api.ts`

**Step 1: preload 暴露 api**

`paperlens/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, ChatMessage, Note, Paper } from '@shared/types'

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (p: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:set', p),
  listPapers: (): Promise<Paper[]> => ipcRenderer.invoke('zotero:list'),
  getPaperText: (paper: Paper): Promise<string> => ipcRenderer.invoke('paper:text', paper),
  sendChat: (a: { paper: Paper; paperText: string; history: ChatMessage[]; input: string }): Promise<string> =>
    ipcRenderer.invoke('chat:send', a),
  addNote: (n: { paperKey: string; content: string; tags: string[] }): Promise<Note> =>
    ipcRenderer.invoke('notes:add', n),
  listNotes: (paperKey: string): Promise<Note[]> => ipcRenderer.invoke('notes:list', paperKey),
  syncNote: (a: { noteId: string; paper: Paper }): Promise<string> => ipcRenderer.invoke('notes:sync', a),
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
```

**Step 2: renderer 端类型声明**

`paperlens/src/renderer/api.ts`:
```ts
import type { Api } from '../preload/index'

declare global {
  interface Window { api: Api }
}
export const api = (): Api => window.api
```

**Step 3: 类型检查**

Run: `cd paperlens && npx tsc --noEmit`
Expected: 无错误。

**Step 4: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/preload/index.ts paperlens/src/renderer/api.ts
git commit -m "feat: preload bridge exposing typed window.api"
```

---

## Phase 9：React UI

> UI 逻辑用 React Testing Library 测「渲染 + 交互调用 api」，`window.api` 用 mock 注入。pdf 渲染组件依赖 canvas，难以在 jsdom 跑真实渲染，因此把「可测的状态逻辑」与「渲染副作用」分离，只测前者。

### Task 14：Renderer 入口 + 路由骨架

**Files:**
- Create: `paperlens/src/renderer/index.html`
- Create: `paperlens/src/renderer/main.tsx`
- Create: `paperlens/src/renderer/App.tsx`
- Test: `paperlens/tests/renderer/App.test.tsx`

**Step 1: 写失败测试**

`paperlens/tests/renderer/App.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../../src/renderer/App'

beforeEach(() => {
  ;(window as any).api = {
    listPapers: vi.fn(async () => []),
    getConfig: vi.fn(async () => ({ zoteroApiKey: '', zoteroUserId: '', deepseekApiKey: '', deepseekModel: 'deepseek-chat', notionToken: '', notionDatabaseId: '' })),
  }
})

describe('App', () => {
  it('renders the three-pane layout with library, reader, chat regions', async () => {
    render(<App />)
    expect(await screen.findByRole('navigation', { name: /论文库/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /阅读/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /对话/ })).toBeInTheDocument()
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/renderer/App.test.tsx`
Expected: FAIL（`App` 不存在）。

**Step 3: 最小实现**

`paperlens/src/renderer/App.tsx`:
```tsx
import { useState } from 'react'
import type { Paper } from '@shared/types'
import { LibraryView } from './components/LibraryView'
import { ReaderView } from './components/ReaderView'
import { ChatView } from './components/ChatView'

export function App() {
  const [selected, setSelected] = useState<Paper | null>(null)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 420px', height: '100vh' }}>
      <nav aria-label="论文库" style={{ overflow: 'auto', borderRight: '1px solid #ddd' }}>
        <LibraryView onSelect={setSelected} selectedKey={selected?.key ?? null} />
      </nav>
      <section aria-label="阅读" role="region" style={{ overflow: 'auto' }}>
        <ReaderView paper={selected} />
      </section>
      <section aria-label="对话" role="region" style={{ overflow: 'auto', borderLeft: '1px solid #ddd' }}>
        <ChatView paper={selected} />
      </section>
    </div>
  )
}
```

`paperlens/src/renderer/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './api'

createRoot(document.getElementById('root')!).render(<App />)
```

`paperlens/src/renderer/index.html`:
```html
<!doctype html>
<html lang="zh">
  <head><meta charset="UTF-8" /><title>PaperLens</title></head>
  <body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```

> 为让本测试通过，需要先创建 LibraryView/ReaderView/ChatView 的最小桩（下一步实现完整版会替换）。可先建占位组件返回各自标题文本。

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/renderer/App.test.tsx`
Expected: PASS。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/renderer/App.tsx paperlens/src/renderer/main.tsx paperlens/src/renderer/index.html paperlens/tests/renderer/App.test.tsx
git commit -m "feat: renderer three-pane app shell"
```

---

### Task 15：LibraryView —— 加载并展示 Zotero 论文

**Files:**
- Create: `paperlens/src/renderer/components/LibraryView.tsx`
- Test: `paperlens/tests/renderer/LibraryView.test.tsx`

**Step 1: 写失败测试**

`paperlens/tests/renderer/LibraryView.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LibraryView } from '../../src/renderer/components/LibraryView'

const papers = [
  { key: 'P1', title: 'Transformer', authors: ['Vaswani'], year: 2017, abstract: '', attachmentKey: null },
  { key: 'P2', title: 'BERT', authors: ['Devlin'], year: 2018, abstract: '', attachmentKey: null },
]

describe('LibraryView', () => {
  it('lists papers from api and notifies on click', async () => {
    ;(window as any).api = { listPapers: vi.fn(async () => papers) }
    const onSelect = vi.fn()
    render(<LibraryView onSelect={onSelect} selectedKey={null} />)

    expect(await screen.findByText('Transformer')).toBeInTheDocument()
    expect(screen.getByText('BERT')).toBeInTheDocument()

    fireEvent.click(screen.getByText('BERT'))
    expect(onSelect).toHaveBeenCalledWith(papers[1])
  })

  it('shows an error message when loading fails', async () => {
    ;(window as any).api = { listPapers: vi.fn(async () => { throw new Error('403') }) }
    render(<LibraryView onSelect={vi.fn()} selectedKey={null} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/加载失败/))
  })
})
```

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/renderer/LibraryView.test.tsx`
Expected: FAIL。

**Step 3: 最小实现**

`paperlens/src/renderer/components/LibraryView.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Paper } from '@shared/types'

export function LibraryView({ onSelect, selectedKey }: { onSelect: (p: Paper) => void; selectedKey: string | null }) {
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listPapers().then(setPapers).catch(() => setError('加载失败，请检查 Zotero 配置'))
  }, [])

  if (error) return <div role="alert" style={{ padding: 12, color: 'crimson' }}>{error}</div>
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {papers.map(p => (
        <li key={p.key}
            onClick={() => onSelect(p)}
            style={{ padding: '10px 12px', cursor: 'pointer', background: p.key === selectedKey ? '#eef' : undefined }}>
          <div style={{ fontWeight: 600 }}>{p.title}</div>
          <div style={{ fontSize: 12, color: '#666' }}>{p.authors.join(', ')} · {p.year ?? ''}</div>
        </li>
      ))}
    </ul>
  )
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/renderer/LibraryView.test.tsx`
Expected: PASS（2 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/renderer/components/LibraryView.tsx paperlens/tests/renderer/LibraryView.test.tsx
git commit -m "feat: library view loading zotero papers"
```

---

### Task 16：ChatView —— 与 AI 对话并存为笔记

**Files:**
- Create: `paperlens/src/renderer/components/ChatView.tsx`
- Test: `paperlens/tests/renderer/ChatView.test.tsx`

**Step 1: 写失败测试**

`paperlens/tests/renderer/ChatView.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatView } from '../../src/renderer/components/ChatView'

const paper = { key: 'P1', title: 'T', authors: ['A'], year: 2020, abstract: '', attachmentKey: null }

describe('ChatView', () => {
  it('sends user input and renders assistant reply', async () => {
    ;(window as any).api = {
      getPaperText: vi.fn(async () => '论文全文'),
      sendChat: vi.fn(async () => '这是AI的回答'),
    }
    render(<ChatView paper={paper} />)

    fireEvent.change(screen.getByРlaceholderText?.(/输入问题/) ?? screen.getByRole('textbox'), { target: { value: '讲讲贡献' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))

    expect(await screen.findByText('讲讲贡献')).toBeInTheDocument()
    expect(await screen.findByText('这是AI的回答')).toBeInTheDocument()
    expect((window as any).api.sendChat).toHaveBeenCalledWith(
      expect.objectContaining({ input: '讲讲贡献', paper })
    )
  })

  it('saves the last assistant reply as a note', async () => {
    const addNote = vi.fn(async () => ({}))
    ;(window as any).api = {
      getPaperText: vi.fn(async () => 'x'),
      sendChat: vi.fn(async () => '可保存的学习要点'),
      addNote,
    }
    render(<ChatView paper={paper} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await screen.findByText('可保存的学习要点')

    fireEvent.click(screen.getByRole('button', { name: /存为笔记/ }))
    await waitFor(() => expect(addNote).toHaveBeenCalledWith(
      expect.objectContaining({ paperKey: 'P1', content: '可保存的学习要点' })
    ))
  })
})
```

> 注：上面 `getByРlaceholderText` 中有个故意的容错写法，实际实现请用标准 `getByPlaceholderText(/输入问题/)`。落地测试时请用标准 API。

**Step 2: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/renderer/ChatView.test.tsx`
Expected: FAIL。

**Step 3: 最小实现**

`paperlens/src/renderer/components/ChatView.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Paper } from '@shared/types'

export function ChatView({ paper }: { paper: Paper | null }) {
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const paperText = useRef('')

  useEffect(() => {
    setHistory([])
    paperText.current = ''
    if (paper) window.api.getPaperText(paper).then(t => { paperText.current = t })
  }, [paper?.key])

  if (!paper) return <div style={{ padding: 12, color: '#888' }}>请选择一篇论文开始对话</div>

  async function send() {
    if (!input.trim() || busy) return
    const userMsg: ChatMessage = { role: 'user', content: input }
    const nextHistory = [...history, userMsg]
    setHistory(nextHistory)
    setInput('')
    setBusy(true)
    try {
      const reply = await window.api.sendChat({ paper: paper!, paperText: paperText.current, history, input: userMsg.content })
      setHistory([...nextHistory, { role: 'assistant', content: reply }])
    } finally {
      setBusy(false)
    }
  }

  async function saveLastAsNote() {
    const last = [...history].reverse().find(m => m.role === 'assistant')
    if (last) await window.api.addNote({ paperKey: paper!.key, content: last.content, tags: [] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {history.map((m, i) => (
          <div key={i} style={{ margin: '8px 0', textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: 8, background: m.role === 'user' ? '#dpe' : '#f0f0f0' }}>
              {m.content}
            </span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #ddd', padding: 8 }}>
        <button onClick={saveLastAsNote} disabled={!history.some(m => m.role === 'assistant')}>存为笔记</button>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            role="textbox" placeholder="输入问题…" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send() }}
            style={{ flex: 1 }} />
          <button onClick={send} disabled={busy}>发送</button>
        </div>
      </div>
    </div>
  )
}
```

**Step 4: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/renderer/ChatView.test.tsx`
Expected: PASS（2 个测试）。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/renderer/components/ChatView.tsx paperlens/tests/renderer/ChatView.test.tsx
git commit -m "feat: chat view with deepseek conversation + save note"
```

---

### Task 17：ReaderView + SettingsView + Notion 同步按钮

**Files:**
- Create: `paperlens/src/renderer/components/ReaderView.tsx`
- Create: `paperlens/src/renderer/components/SettingsView.tsx`
- Test: `paperlens/tests/renderer/SettingsView.test.tsx`
- Test: `paperlens/tests/renderer/ReaderView.test.tsx`

**Step 1: 写 SettingsView 失败测试**（设置面板保存配置）

`paperlens/tests/renderer/SettingsView.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsView } from '../../src/renderer/components/SettingsView'

const empty = { zoteroApiKey: '', zoteroUserId: '', deepseekApiKey: '', deepseekModel: 'deepseek-chat', notionToken: '', notionDatabaseId: '' }

describe('SettingsView', () => {
  it('loads existing config and saves edits', async () => {
    const setConfig = vi.fn(async (p: any) => ({ ...empty, ...p }))
    ;(window as any).api = { getConfig: vi.fn(async () => empty), setConfig }
    render(<SettingsView onClose={vi.fn()} />)

    fireEvent.change(await screen.findByLabelText(/Zotero User ID/), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText(/Zotero API Key/), { target: { value: 'zk' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ zoteroUserId: '42', zoteroApiKey: 'zk' })
    ))
  })
})
```

**Step 2: 写 ReaderView 失败测试**（展示笔记列表 + 同步按钮调用 api）

`paperlens/tests/renderer/ReaderView.test.tsx`:
```tsx
import { describe, it, expect, vi, waitFor } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReaderView } from '../../src/renderer/components/ReaderView'

const paper = { key: 'P1', title: 'T', authors: ['A'], year: 2020, abstract: 'abs', attachmentKey: null }

describe('ReaderView', () => {
  it('shows paper notes and syncs a note to notion on click', async () => {
    const note = { id: 'n1', paperKey: 'P1', content: '要点', tags: [], createdAt: 1, notionPageId: null }
    const syncNote = vi.fn(async () => 'page-1')
    ;(window as any).api = {
      listNotes: vi.fn(async () => [note]),
      syncNote,
    }
    render(<ReaderView paper={paper} />)
    expect(await screen.findByText('要点')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /同步到 Notion/ }))
    await waitFor(() => expect(syncNote).toHaveBeenCalledWith({ noteId: 'n1', paper }))
  })
})
```

**Step 3: 运行验证失败**

Run: `cd paperlens && npx vitest run tests/renderer/SettingsView.test.tsx tests/renderer/ReaderView.test.tsx`
Expected: FAIL。

**Step 4: 最小实现**

`paperlens/src/renderer/components/SettingsView.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { AppConfig } from '@shared/types'

const FIELDS: Array<{ key: keyof AppConfig; label: string; secret?: boolean }> = [
  { key: 'zoteroUserId', label: 'Zotero User ID' },
  { key: 'zoteroApiKey', label: 'Zotero API Key', secret: true },
  { key: 'deepseekApiKey', label: 'DeepSeek API Key', secret: true },
  { key: 'deepseekModel', label: 'DeepSeek Model' },
  { key: 'notionToken', label: 'Notion Token', secret: true },
  { key: 'notionDatabaseId', label: 'Notion Database ID' },
]

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  useEffect(() => { window.api.getConfig().then(setCfg) }, [])
  if (!cfg) return null

  return (
    <div style={{ padding: 16, display: 'grid', gap: 10, maxWidth: 480 }}>
      <h2>设置</h2>
      {FIELDS.map(f => (
        <label key={f.key} style={{ display: 'grid', gap: 4 }}>
          <span>{f.label}</span>
          <input
            type={f.secret ? 'password' : 'text'}
            value={cfg[f.key]}
            onChange={e => setCfg({ ...cfg, [f.key]: e.target.value })} />
        </label>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={async () => { await window.api.setConfig(cfg); onClose() }}>保存</button>
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  )
}
```

`paperlens/src/renderer/components/ReaderView.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Note, Paper } from '@shared/types'

export function ReaderView({ paper }: { paper: Paper | null }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [syncing, setSyncing] = useState<string | null>(null)

  useEffect(() => {
    if (paper) window.api.listNotes(paper.key).then(setNotes)
    else setNotes([])
  }, [paper?.key])

  if (!paper) return <div style={{ padding: 12, color: '#888' }}>从左侧选择论文</div>

  async function sync(noteId: string) {
    setSyncing(noteId)
    try {
      await window.api.syncNote({ noteId, paper: paper! })
      setNotes(await window.api.listNotes(paper!.key))
    } finally { setSyncing(null) }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>{paper.title}</h2>
      <p style={{ color: '#666' }}>{paper.authors.join(', ')} · {paper.year ?? ''}</p>
      <p>{paper.abstract}</p>
      <h3>学习笔记</h3>
      {notes.length === 0 && <p style={{ color: '#999' }}>暂无笔记，去右侧与 AI 对话并「存为笔记」。</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {notes.map(n => (
          <li key={n.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div>{n.content}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
              {n.notionPageId ? '✓ 已同步 Notion' : (
                <button onClick={() => sync(n.id)} disabled={syncing === n.id}>同步到 Notion</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

> ReaderView 当前先展示元数据 + 笔记 + 同步。**真实 PDF 渲染**（pdfjs canvas）作为增量在 Task 19 加入，避免在本任务把 jsdom 测试搞复杂。

**Step 5: 运行验证通过**

Run: `cd paperlens && npx vitest run tests/renderer/`
Expected: PASS（全部 renderer 测试）。

**Step 6: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/renderer/components/ReaderView.tsx paperlens/src/renderer/components/SettingsView.tsx paperlens/tests/renderer/SettingsView.test.tsx paperlens/tests/renderer/ReaderView.test.tsx
git commit -m "feat: reader view (notes+notion sync) and settings view"
```

---

## Phase 10：端到端冒烟与打包

### Task 18：全量回归 + 手动冒烟清单

**Files:**
- Create: `paperlens/docs/SMOKE.md`

**Step 1: 全量测试 + 类型检查**

Run: `cd paperlens && npx vitest run && npx tsc --noEmit`
Expected: 所有测试 PASS，类型零错误。

**Step 2: 启动应用冒烟**

Run: `cd paperlens && npm run dev`
Expected: 应用窗口打开，三栏布局可见。

**Step 3: 手动验证清单**

`paperlens/docs/SMOKE.md`:
```markdown
# 手动冒烟清单

前置：在「设置」填入真实凭证
- Zotero: User ID（在 zotero.org/settings/keys 查看）+ API Key（新建，勾选 library read）
- DeepSeek: API Key（platform.deepseek.com）
- Notion: Internal Integration Token + 目标数据库 ID（数据库需含列：Title[title]、Authors[rich text]、Year[number]、Tags[multi-select]，并把集成 invite 到该数据库）

步骤：
1. [ ] 左栏出现 Zotero 论文列表
2. [ ] 点击一篇论文，中栏显示标题/作者/摘要
3. [ ] 右栏输入问题 → 收到 DeepSeek 回答（首次会拉取并缓存 PDF 全文，稍慢）
4. [ ] 点「存为笔记」→ 中栏「学习笔记」出现该笔记
5. [ ] 点「同步到 Notion」→ Notion 数据库新增一行，标题=论文名，正文=笔记
6. [ ] 重复同步同一笔记 → Notion 中为更新而非重复新建
```

**Step 4: 走查清单并修复**

依据 `SMOKE.md` 逐项手动验证。任一项失败 → 用 superpowers:systematic-debugging 定位（先看主进程控制台错误，再看 renderer DevTools）。修复后回到 Step 1 回归。

**Step 5: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperlens/docs/SMOKE.md
git commit -m "docs: add manual smoke checklist"
```

---

### Task 19（增量）：在 ReaderView 内嵌 PDF 渲染

> MVP 之后的增强。Zotero PDF 字节经 IPC 传到 renderer，用 pdfjs 渲染到 canvas。

**Files:**
- Modify: `paperlens/src/main/ipc.ts`（加 `paper:pdfBytes` handler）
- Modify: `paperlens/src/preload/index.ts`（加 `getPaperPdf`）
- Modify: `paperlens/src/renderer/components/ReaderView.tsx`
- Create: `paperlens/src/renderer/components/PdfCanvas.tsx`

**Step 1:** main 增加返回 PDF 字节的 handler（复用 zotero downloadAttachment）。

**Step 2:** preload 暴露 `getPaperPdf(paper): Promise<ArrayBuffer>`。

**Step 3:** `PdfCanvas.tsx` 用 `pdfjs-dist` 的 `getDocument` + worker，逐页 `page.render` 到 canvas（worker 通过 `import pdfWorker from 'pdfjs-dist/build/pdf.worker?url'` 设置 `GlobalWorkerOptions.workerSrc`）。

**Step 4:** ReaderView 顶部「摘要 / 全文 PDF」切换 tab，PDF tab 挂载 PdfCanvas。

**Step 5:** 手动验证 PDF 可见、可滚动翻页。

**Step 6: Commit**
```bash
cd /Users/zhangyixuan06/work
git add paperlens/src/main/ipc.ts paperlens/src/preload/index.ts paperlens/src/renderer/components/ReaderView.tsx paperlens/src/renderer/components/PdfCanvas.tsx
git commit -m "feat: in-app pdf rendering via pdfjs canvas"
```

---

### Task 20（增量）：流式回复 + 打包

**Files:**
- Modify: `paperlens/src/main/services/ai-chat.ts`（加 `stream()` 用 SSE）
- Modify: `paperlens/src/main/ipc.ts`（用 `webContents.send` 推 token）
- Modify: `paperlens/src/renderer/components/ChatView.tsx`（增量渲染）
- Modify: `paperlens/package.json`（加 electron-builder 配置与脚本）

**Step 1:** DeepSeek `stream: true`，解析 `data:` SSE 行，逐 token 回调（注入 fetch 仍可测：fake 一个返回 ReadableStream 的 Response，断言累计文本）。

**Step 2:** 打包用 electron-builder：`npm i -D electron-builder`，加 `build` 配置（mac dmg / win nsis），脚本 `"dist": "electron-vite build && electron-builder"`。

**Step 3:** Run `cd paperlens && npm run dist` 产出安装包。

**Step 4: Commit**
```bash
cd /Users/zhangyixuan06/work
git add -A
git commit -m "feat: streaming chat + electron-builder packaging"
```

---

## 执行顺序与里程碑

| 里程碑 | 完成的 Task | 可演示的能力 |
|---|---|---|
| M1 工程就绪 | 0–1 | 构建/测试通道打通，领域类型就位 |
| M2 数据后端 | 2–11 | 所有 Service 单测绿（Zotero/PDF/DB/AI/Notion/Config） |
| M3 应用骨架 | 12–14 | Electron 起得来，三栏 UI 出现 |
| M4 核心闭环 | 15–18 | **端到端可用**：选论文→AI 对话→存笔记→同步 Notion |
| M5 体验增强 | 19–20 | 内嵌 PDF 阅读、流式回复、可分发安装包 |

**MVP = 完成到 M4（Task 18）。** Task 19–20 是增量增强，可在 MVP 验证后再做。

---

## 给执行者的提醒

- **严格 TDD**：每个 Task 先红后绿，绝不跳过「运行测试看它失败」这一步。
- **DI 是测试可行的关键**：所有 Service 的 `fetch`/`db`/`crypto`/`now`/`genId` 都从参数注入，单测永不触网/触盘（除 `:memory:` SQLite）。
- **密钥安全**：renderer 永远拿不到明文密钥；所有外部调用在 main 进程。审查每个新 IPC 是否泄露敏感数据。
- **频繁提交**：每个 Task 末尾一个 commit，信息用 `feat:`/`chore:`/`docs:` 前缀。
- **遇到 bug**：用 superpowers:systematic-debugging，先复现再修，别猜。
- **真实 API 形状若与计划不符**（Zotero/DeepSeek/Notion 字段），以官方文档为准，更新对应 Service 的测试夹具再改实现。
