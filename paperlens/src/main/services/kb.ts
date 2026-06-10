import type { ChatMessage } from '@shared/types'

// 论文全文切块：固定窗口 + 重叠，保证检索段落上下文完整
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const t = text.trim()
  if (!t) return []
  const step = Math.max(1, size - overlap)
  const out: string[] = []
  for (let i = 0; i < t.length; i += step) {
    out.push(t.slice(i, i + size))
    if (i + size >= t.length) break
  }
  return out
}

export function buildQueryExpansionMessages(question: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是文献检索助手。把用户问题改写成 3-6 个适合全文检索的关键词/短语，' +
        '必须中英文混合（论文多为英文，需包含英文术语）。' +
        '只输出一个 JSON 字符串数组，例如 ["RLHF","人类反馈","reward model"]，不要任何其他文字。',
    },
    { role: 'user', content: question },
  ]
}

export function parseQueryTerms(text: string): string[] {
  const m = text.match(/\[[\s\S]*?\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as unknown
    if (!Array.isArray(arr)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const t of arr) {
      if (typeof t !== 'string') continue
      const s = t.trim()
      if (s.length < 2 || seen.has(s)) continue
      seen.add(s)
      out.push(s)
      if (out.length >= 6) break
    }
    return out
  } catch {
    return []
  }
}

export interface KbHit {
  paperTitle: string
  text: string
}

export function buildKbAnswerMessages(question: string, hits: KbHit[]): ChatMessage[] {
  const sources = hits
    .map((h, i) => `【来源${i + 1} · ${h.paperTitle}】\n${h.text}`)
    .join('\n\n')
  return [
    {
      role: 'system',
      content:
        '你是论文知识库助手。只依据下面提供的论文片段回答用户问题；' +
        '引用某片段的内容时在句末标注 [来源N]（即来源标注）；' +
        '如果片段中没有提及答案，明确说明「库内片段没有提及」，不要编造。\n\n' +
        sources,
    },
    { role: 'user', content: question },
  ]
}
