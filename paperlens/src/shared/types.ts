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
  zoteroDataDir: z.string().default(''),
  deepseekApiKey: z.string().default(''),
  deepseekModel: z.string().default('deepseek-chat'),
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
