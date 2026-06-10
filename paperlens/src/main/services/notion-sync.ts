import type { Note, Paper } from '@shared/types'

const txt = (content: string) => [{ text: { content } }]

export function noteToNotionPage(note: Note, paper: Paper, databaseId: string) {
  const properties: Record<string, any> = {
    Title: { title: txt(paper.title) },
    Authors: { rich_text: txt(paper.authors.join(', ')) },
    Tags: { multi_select: note.tags.map(name => ({ name })) },
  }
  if (paper.year !== null) properties.Year = { number: paper.year }

  // Notion 限制单个 rich_text 内容 ≤2000 字符——长笔记按 2000 切成多个段落块
  const chunks: string[] = []
  for (let i = 0; i < note.content.length; i += 2000) chunks.push(note.content.slice(i, i + 2000))
  if (chunks.length === 0) chunks.push('')

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
