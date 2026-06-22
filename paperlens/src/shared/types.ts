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

// DeepSeek 默认模型。v4（2026-07-24 起）deepseek-chat / deepseek-reasoner 退役，
// 统一为 deepseek-v4-flash（思考模式由请求参数切换，不再是独立模型名）。
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'

export const AppConfigSchema = z.object({
  zoteroApiKey: z.string().default(''),
  zoteroUserId: z.string().default(''),
  zoteroDataDir: z.string().default(''),
  deepseekApiKey: z.string().default(''),
  deepseekModel: z.string().default(DEFAULT_DEEPSEEK_MODEL),
  notionToken: z.string().default(''),
  notionDatabaseId: z.string().default(''),
})
export type AppConfig = z.infer<typeof AppConfigSchema>

// Zotero 文件夹（collection），parentKey 为 null 表示顶层
export interface ZoteroCollection {
  key: string
  name: string
  parentKey: string | null
}

// PDF 高亮标注。rects 为 PDF 坐标系矩形 [x1,y1,x2,y2]（原点左下，单位 pt）。
// zoteroKey 在推送到 Zotero 成功后回填，非 null 即「已同步」。
export interface Highlight {
  id: string
  paperKey: string
  pageIndex: number // 0 基页码（与 Zotero annotationPosition.pageIndex 对齐）
  rects: number[][]
  text: string
  color: string // 十六进制，如 '#ffd400'
  comment: string | null
  zoteroKey: string | null
  createdAt: number
}
