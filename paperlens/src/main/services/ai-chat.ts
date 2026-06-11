import type { Paper, ChatMessage } from '@shared/types'
import { DEFAULT_DEEPSEEK_MODEL } from '@shared/types'

export interface BuildMessagesInput {
  paper: Paper
  paperText: string
  history: ChatMessage[]
  userInput: string
  maxContextChars?: number
  maxHistoryMessages?: number
}

export interface BuiltContext {
  messages: ChatMessage[]
  usedChars: number
  totalChars: number
  truncated: boolean
}

export function buildMessages(input: BuildMessagesInput): BuiltContext {
  const max = input.maxContextChars ?? 240_000
  const maxHistory = input.maxHistoryMessages ?? 20
  const totalChars = input.paperText.length
  const truncated = totalChars > max
  let text: string
  let usedChars: number
  if (truncated) {
    // 头尾保留：前 70% 上限 + 省略标记 + 后 30% 上限，让结论/局限等尾部内容不被丢弃
    const headLen = Math.floor(max * 0.7)
    const tailLen = max - headLen
    text = input.paperText.slice(0, headLen) + '\n\n…（中间略）…\n\n' + input.paperText.slice(totalChars - tailLen)
    usedChars = max
  } else {
    text = input.paperText
    usedChars = totalChars
  }
  const recentHistory = input.history.slice(-maxHistory)
  const meta = `标题：${input.paper.title}\n作者：${input.paper.authors.join(', ')}\n年份：${input.paper.year ?? '未知'}`
  const contextNote = truncated ? '正文已截断，仅含首尾部分' : '已含全文'
  const system: ChatMessage = {
    role: 'system',
    content:
      `你是一个严谨的论文学习助手。基于以下论文与用户对话，帮助用户深入理解。` +
      `只依据论文内容作答，不确定时明确说明。` +
      '\n当正文中出现 [第N页] 标记时，它表示该页起始；你引用论文具体内容时，请在该句末尾标注 [页N]（N 为页码），便于用户跳转核对。' +
      `\n\n【论文元数据】\n${meta}\n\n【论文正文（${contextNote}）】\n${text}`,
  }
  const messages: ChatMessage[] = [system, ...recentHistory, { role: 'user', content: input.userInput }]
  return { messages, usedChars, totalChars, truncated }
}

export type StreamTokenKind = 'content' | 'reasoning'

// DeepSeek v4（2026-07-24 起）：deepseek-chat / deepseek-reasoner 退役，统一为
// deepseek-v4-flash，「深思」不再是独立模型名，而是请求参数 thinking.type。
// 把升级前存过旧模型名的配置兜底映射到 v4，用户无需手动改配置即可继续使用。
const RETIRED_MODELS: Record<string, string> = {
  'deepseek-chat': DEFAULT_DEEPSEEK_MODEL,
  'deepseek-reasoner': DEFAULT_DEEPSEEK_MODEL,
}
export function resolveModel(model: string): string {
  return RETIRED_MODELS[model] ?? model
}

export interface AiChatDeps {
  apiKey: string
  model: string
  fetch: typeof fetch
  baseUrl?: string
  /** 深思模式：true → thinking.type=enabled（流式回传 reasoning_content + content）；
   *  缺省/false → thinking.type=disabled（仅 content）。对应旧版 deepseek-reasoner 与
   *  deepseek-chat 的区别，可观察行为不变。 */
  deepThink?: boolean
}

export function createAiChat(deps: AiChatDeps) {
  const url = `${deps.baseUrl ?? 'https://api.deepseek.com'}/chat/completions`
  const model = resolveModel(deps.model)
  // 两种模式都显式声明 thinking，不依赖服务端默认（v4 默认是否开启思考随文档而变）：
  // 确保非深思路径（complete/普通流式）绝不被默认思考模式拖慢、绝不冒出 reasoning_content。
  const thinking = { type: deps.deepThink ? 'enabled' : 'disabled' } as const

  async function complete(messages: ChatMessage[]): Promise<string> {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.apiKey}` },
      body: JSON.stringify({ model, messages, stream: false, thinking }),
    })
    if (!res.ok) throw new Error(`DeepSeek request failed: ${res.status}`)
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content ?? ''
  }

  const isAbortError = (err: unknown): boolean =>
    err instanceof Error && err.name === 'AbortError'

  async function stream(
    messages: ChatMessage[],
    onToken: (delta: string, kind: StreamTokenKind) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    let res: Response
    try {
      res = await deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.apiKey}` },
        body: JSON.stringify({ model, messages, stream: true, thinking }),
        signal,
      })
    } catch (err) {
      if (isAbortError(err)) return '' // aborted before any token arrived
      throw err
    }
    if (!res.ok) throw new Error(`DeepSeek stream failed: ${res.status}`)
    if (!res.body) throw new Error('DeepSeek stream: empty body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    for (;;) {
      let done: boolean
      let value: Uint8Array | undefined
      try {
        ;({ done, value } = await reader.read())
      } catch (err) {
        // user-initiated stop: return what we have accumulated so far
        if (isAbortError(err)) break
        throw err
      }
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // keep the trailing (possibly incomplete) line in the buffer
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> }
          const d = json.choices?.[0]?.delta
          if (d?.reasoning_content) onToken(d.reasoning_content, 'reasoning')
          if (d?.content) {
            full += d.content
            onToken(d.content, 'content')
          }
        } catch {
          // ignore malformed/partial JSON lines
        }
      }
    }
    return full
  }

  return { complete, stream }
}

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

export function buildFollowupMessages(paperTitle: string, lastAnswer: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        `你是一个论文学习助手。论文标题：${paperTitle}。` +
        `请基于刚才的回答，生成 3 个用户可能想继续问的简短追问（每个不超过 20 字），` +
        `只输出一个 JSON 字符串数组，例如 ["实验如何设计？","有哪些局限？","结论是什么？"]，不要任何其他文字。`,
    },
    { role: 'user', content: lastAnswer.slice(0, 2_000) },
  ]
}

export function parseFollowups(text: string): string[] {
  const m = text.match(/\[[\s\S]*?\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map(q => q.trim())
      .slice(0, 3)
  } catch {
    return []
  }
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
