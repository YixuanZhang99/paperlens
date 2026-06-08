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
