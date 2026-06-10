import type { Paper, ChatMessage } from '@shared/types'

export interface BuildMessagesInput {
  paper: Paper
  paperText: string
  history: ChatMessage[]
  userInput: string
  maxContextChars?: number
  maxHistoryMessages?: number
}

export function buildMessages(input: BuildMessagesInput): ChatMessage[] {
  const max = input.maxContextChars ?? 60_000
  const maxHistory = input.maxHistoryMessages ?? 20
  const text = input.paperText.slice(0, max)
  const recentHistory = input.history.slice(-maxHistory)
  const meta = `标题：${input.paper.title}\n作者：${input.paper.authors.join(', ')}\n年份：${input.paper.year ?? '未知'}`
  const system: ChatMessage = {
    role: 'system',
    content:
      `你是一个严谨的论文学习助手。基于以下论文与用户对话，帮助用户深入理解。` +
      `只依据论文内容作答，不确定时明确说明。\n\n【论文元数据】\n${meta}\n\n【论文正文（可能截断）】\n${text}`,
  }
  return [system, ...recentHistory, { role: 'user', content: input.userInput }]
}

export type StreamTokenKind = 'content' | 'reasoning'

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

  async function stream(messages: ChatMessage[], onToken: (delta: string, kind: StreamTokenKind) => void): Promise<string> {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.apiKey}` },
      body: JSON.stringify({ model: deps.model, messages, stream: true }),
    })
    if (!res.ok) throw new Error(`DeepSeek stream failed: ${res.status}`)
    if (!res.body) throw new Error('DeepSeek stream: empty body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    for (;;) {
      const { done, value } = await reader.read()
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
