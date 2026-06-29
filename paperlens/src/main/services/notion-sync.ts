import type { Note, Paper } from '@shared/types'

// Notion API 长度/格式上限（超限会整请求 400）
const MAX_TEXT = 2000   // rich_text / title 单段 content ≤ 2000 字符
const MAX_BLOCKS = 100  // 单次创建 page 的 children block ≤ 100
const MAX_TAG = 100     // multi_select 选项名 ≤ 100 字符

const clamp = (s: string, max = MAX_TEXT) => (s.length > max ? s.slice(0, max) : s)
const txt = (content: string) => [{ text: { content: clamp(content) } }]
// multi_select 选项名：不能含逗号(会被拆/400)、≤100 字、非空
const toTagOption = (name: string) => clamp(name.replace(/,/g, ' '), MAX_TAG).trim()

export function noteToNotionPage(note: Note, paper: Paper, databaseId: string) {
  const properties: Record<string, any> = {
    Title: { title: txt(paper.title) },
    Authors: { rich_text: txt(paper.authors.join(', ')) },
    Tags: { multi_select: note.tags.map(toTagOption).filter(Boolean).map(name => ({ name })) },
  }
  // Year 必须是合法有限整数，否则 Notion number 校验失败
  if (paper.year !== null && Number.isFinite(paper.year) && Number.isInteger(paper.year)) {
    properties.Year = { number: paper.year }
  }

  // 正文按 2000 切成多个段落块；总块数封顶 100，超出截断并提示
  let chunks: string[] = []
  for (let i = 0; i < note.content.length; i += MAX_TEXT) chunks.push(note.content.slice(i, i + MAX_TEXT))
  if (chunks.length === 0) chunks.push('')
  if (chunks.length > MAX_BLOCKS) {
    chunks = chunks.slice(0, MAX_BLOCKS - 1)
    chunks.push('（内容较长，已截断；完整内容见 PaperLens 应用内笔记）')
  }

  return {
    parent: { database_id: databaseId },
    properties,
    children: chunks.map(c => (
      { object: 'block', type: 'paragraph', paragraph: { rich_text: txt(c) } }
    )),
  }
}

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
