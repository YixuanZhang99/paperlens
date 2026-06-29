import { describe, it, expect, vi } from 'vitest'
import { createAiChat, buildMessages, buildFollowupMessages, parseFollowups } from '../../src/main/services/ai-chat'
import type { ChatMessage, Paper } from '@shared/types'

const paper: Paper = {
  key: 'P1', title: 'Transformer', authors: ['Vaswani'], year: 2017,
  abstract: 'attention', attachmentKey: null,
}

describe('buildMessages → BuiltContext', () => {
  it('injects the full text when under the cap: truncated=false, usedChars==totalChars', () => {
    const text = '论文开头。' + 'x'.repeat(500) + '论文结尾。'
    const ctx = buildMessages({ paper, paperText: text, history: [], userInput: '讲了什么？' })
    expect(ctx.truncated).toBe(false)
    expect(ctx.totalChars).toBe(text.length)
    expect(ctx.usedChars).toBe(text.length)
    expect(ctx.messages[0].role).toBe('system')
    expect(ctx.messages[0].content).toContain(text)
    expect(ctx.messages[0].content).toContain('已含全文')
    expect(ctx.messages[0].content).not.toContain('已截断')
    expect(ctx.messages.at(-1)).toEqual({ role: 'user', content: '讲了什么？' })
  })

  it('keeps head+tail of an over-long text (300k chars, default 240k cap)', () => {
    const HEAD = '【哨兵-开头-7f3a】'
    const TAIL = '【哨兵-结尾-9c2e】'
    const total = 300_000
    const text = HEAD + 'x'.repeat(total - HEAD.length - TAIL.length) + TAIL
    const ctx = buildMessages({ paper, paperText: text, history: [], userInput: '局限是什么？' })
    expect(ctx.truncated).toBe(true)
    expect(ctx.totalChars).toBe(300_000)
    expect(ctx.usedChars).toBe(240_000)
    // both the beginning AND the end of the paper survive truncation
    expect(ctx.messages[0].content).toContain(HEAD)
    expect(ctx.messages[0].content).toContain(TAIL)
    expect(ctx.messages[0].content).toContain('…（中间略）…')
    // system prompt states the truncation mode
    expect(ctx.messages[0].content).toContain('正文已截断，仅含首尾部分')
    expect(ctx.messages[0].content).not.toContain('已含全文')
  })

  it('splits the cap 70% head / 30% tail around the ellipsis marker', () => {
    const text = 'ABCDEFG' + 'MMMMM' + 'XYZ' // 15 chars, cap 10 → head 7 + tail 3
    const ctx = buildMessages({ paper, paperText: text, history: [], userInput: 'q', maxContextChars: 10 })
    expect(ctx.truncated).toBe(true)
    expect(ctx.usedChars).toBe(10)
    expect(ctx.totalChars).toBe(15)
    expect(ctx.messages[0].content).toContain('ABCDEFG\n\n…（中间略）…\n\nXYZ')
    expect(ctx.messages[0].content).not.toContain('M')
  })

  it('keeps [system, ...recentHistory, user] message shape with metadata', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
    ]
    const ctx = buildMessages({ paper, paperText: 'abc', history, userInput: '第二问' })
    expect(ctx.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(ctx.messages[0].content).toContain('Transformer')
    expect(ctx.messages[0].content).toContain('Vaswani')
    expect(ctx.messages.at(-1)).toEqual({ role: 'user', content: '第二问' })
  })

  it('still caps history to the most recent maxHistoryMessages', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }))
    const ctx = buildMessages({ paper, paperText: 'x', history, userInput: '新问题', maxHistoryMessages: 4 })
    expect(ctx.messages).toHaveLength(6)
    expect(ctx.messages.slice(1, 5).map(m => m.content)).toEqual(['m26', 'm27', 'm28', 'm29'])
  })

  it('buildMessages instructs page citation with [页N]', () => {
    const { messages } = buildMessages({ paper: { title: 'T', authors: [], year: 2020 } as any, paperText: '[第1页]\n正文', history: [], userInput: 'q' })
    expect(messages[0].content).toMatch(/\[页N\]|页码|\[第N页\]/)
  })

  it('buildMessages instructs sentence-level citation format [页N:"原文短句"]', () => {
    const { messages } = buildMessages({ paper: { title: 'T', authors: [], year: 2020 } as any, paperText: '[第1页]\n正文', history: [], userInput: 'q' })
    expect(messages[0].content).toMatch(/\[页N:"原文短句"\]|原文短句/)
  })
})

describe('createAiChat.stream abort', () => {
  function abortableSse(chunks: string[], errOn: AbortSignal) {
    // never closes by itself — simulates a long generation; aborting errors the
    // body reader with AbortError, exactly like real fetch does
    return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      let ctrl!: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          ctrl = c
          const enc = new TextEncoder()
          for (const chunk of chunks) c.enqueue(enc.encode(chunk))
        },
      })
      errOn.addEventListener('abort', () => {
        ctrl.error(new DOMException('The operation was aborted.', 'AbortError'))
      })
      return new Response(stream, { status: 200 })
    })
  }

  it('forwards the signal to fetch and returns accumulated text on abort instead of throwing', async () => {
    const ac = new AbortController()
    const fetch = abortableSse([
      'data: {"choices":[{"delta":{"content":"部分"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
    ], ac.signal)
    const chat = createAiChat({ apiKey: 'k', fetch })
    const tokens: string[] = []
    const full = await chat.stream([{ role: 'user', content: 'q' }], (d) => {
      tokens.push(d)
      if (tokens.length === 2) ac.abort() // user hits stop after the 2nd token
    }, ac.signal)
    expect(tokens).toEqual(['部分', '答案'])
    expect(full).toBe('部分答案') // partial text returned, no throw
    expect((fetch.mock.calls[0]![1] as RequestInit).signal).toBe(ac.signal)
  })

  it('still completes normally when a signal is provided but never aborted', async () => {
    const ac = new AbortController()
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      const enc = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"完整"}}]}\n\n'))
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"回答"}}]}\n\n'))
          c.enqueue(enc.encode('data: [DONE]\n\n'))
          c.close()
        },
      })
      return new Response(stream, { status: 200 })
    })
    const chat = createAiChat({ apiKey: 'k', fetch })
    const full = await chat.stream([{ role: 'user', content: 'q' }], () => {}, ac.signal)
    expect(full).toBe('完整回答')
  })

  it('still throws non-abort mid-stream errors', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      let first = true
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (first) {
            first = false
            c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"半"}}]}\n\n'))
          } else {
            c.error(new Error('socket hang up'))
          }
        },
      })
      return new Response(stream, { status: 200 })
    })
    const chat = createAiChat({ apiKey: 'k', fetch })
    await expect(chat.stream([{ role: 'user', content: 'q' }], () => {})).rejects.toThrow(/socket hang up/)
  })
})

describe('createAiChat.complete', () => {
  it('posts to deepseek with bearer auth and returns assistant text', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '这篇论文提出了Transformer。' } }],
      }), { status: 200 })
    )
    const chat = createAiChat({ apiKey: 'sk-x', fetch })
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const reply = await chat.complete(msgs)

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect((init!.headers as any)['Authorization']).toBe('Bearer sk-x')
    const body = JSON.parse(init!.body as string)
    expect(body.model).toBe('deepseek-chat')
    expect(body.thinking).toBeUndefined() // complete 永远非深思
    expect(body.messages).toEqual(msgs)
    expect(reply).toBe('这篇论文提出了Transformer。')
  })

  it('throws on non-200', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response('nope', { status: 401 }))
    const chat = createAiChat({ apiKey: 'bad', fetch })
    await expect(chat.complete([{ role: 'user', content: 'x' }])).rejects.toThrow(/DeepSeek.*401/)
  })

  it('sends thinking when provided (DeepSeek 深思=enabled), drops it otherwise', async () => {
    const mk = () => vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }))
    const f1 = mk()
    await createAiChat({ apiKey: 'k', model: 'deepseek-v4-flash', thinking: { type: 'enabled' }, fetch: f1 }).complete([{ role: 'user', content: 'q' }])
    expect(JSON.parse((f1.mock.calls[0]![1] as RequestInit).body as string).thinking).toEqual({ type: 'enabled' })
    const f2 = mk()
    await createAiChat({ apiKey: 'k', model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, fetch: f2 }).complete([{ role: 'user', content: 'q' }])
    expect(JSON.parse((f2.mock.calls[0]![1] as RequestInit).body as string).thinking).toEqual({ type: 'disabled' })
    const f3 = mk()
    await createAiChat({ apiKey: 'k', fetch: f3 }).complete([{ role: 'user', content: 'q' }]) // 无 thinking → 不发
    expect(JSON.parse((f3.mock.calls[0]![1] as RequestInit).body as string).thinking).toBeUndefined()
  })

  it('routes to a custom provider (Kimi/Moonshot): baseUrl + model honored', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '你好' } }] }), { status: 200 }))
    const chat = createAiChat({ apiKey: 'sk-kimi', model: 'moonshot-v1-32k', baseUrl: 'https://api.moonshot.cn/v1', fetch })
    await chat.complete([{ role: 'user', content: 'hi' }])
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.moonshot.cn/v1/chat/completions')
    expect((init!.headers as any)['Authorization']).toBe('Bearer sk-kimi')
    expect(JSON.parse(init!.body as string).model).toBe('moonshot-v1-32k')
  })
})

describe('buildFollowupMessages', () => {
  it('asks for 3 short followup questions as a JSON array, based on the last answer', () => {
    const msgs = buildFollowupMessages('Attention Is All You Need', '本文提出了自注意力机制，摒弃了循环结构。')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('追问')
    expect(msgs[0].content).toContain('JSON')
    expect(msgs[0].content).toContain('3 个')
    expect(msgs[0].content).toContain('Attention Is All You Need')
    expect(msgs[1]).toEqual({ role: 'user', content: '本文提出了自注意力机制，摒弃了循环结构。' })
  })

  it('truncates the last answer to 2000 chars', () => {
    const msgs = buildFollowupMessages('T', 'A'.repeat(3000))
    expect(msgs[1].content).toHaveLength(2000)
  })
})

describe('parseFollowups', () => {
  it('parses a clean JSON array of 3 questions', () => {
    expect(parseFollowups('["实验怎么设计的？","局限在哪里？","如何复现结果？"]'))
      .toEqual(['实验怎么设计的？', '局限在哪里？', '如何复现结果？'])
  })

  it('extracts the first [...] from surrounding prose and trims entries', () => {
    expect(parseFollowups('好的，建议如下：[" 为什么用点积注意力？ ","训练用了多少数据？"] 希望有帮助'))
      .toEqual(['为什么用点积注意力？', '训练用了多少数据？'])
  })

  it('caps at 3 questions', () => {
    expect(parseFollowups('["a","b","c","d","e"]')).toEqual(['a', 'b', 'c'])
  })

  it('filters non-strings and empty strings', () => {
    expect(parseFollowups('["x", 1, "", "   ", null, "y"]')).toEqual(['x', 'y'])
  })

  it('returns [] for garbage', () => {
    expect(parseFollowups('模型今天不想回答')).toEqual([])
    expect(parseFollowups('{"a":1}')).toEqual([])
    expect(parseFollowups('[broken json')).toEqual([])
    expect(parseFollowups('')).toEqual([])
  })
})

