import { describe, it, expect, vi } from 'vitest'
import { createAiChat } from '../../src/main/services/ai-chat'

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('createAiChat.stream', () => {
  it('streams delta tokens, returns full text, and requests stream:true', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"这是"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"AI"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"回答"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    )
    const chat = createAiChat({ apiKey: 'k', fetch })
    const tokens: string[] = []
    const full = await chat.stream([{ role: 'user', content: 'q' }], d => tokens.push(d))

    expect(tokens).toEqual(['这是', 'AI', '回答'])
    expect(full).toBe('这是AI回答')
    const body = JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('deepseek-chat')
    expect(body.thinking).toBeUndefined() // 统一 deepseek-chat，不发 thinking
  })

  it('handles delta content split across stream chunks (partial lines)', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      sseResponse([
        'data: {"choices":[{"delta":{"con',           // line split mid-JSON
        'tent":"片段"}}]}\n\ndata: {"choices":[{"delta":{"content":"完成"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    )
    const chat = createAiChat({ apiKey: 'k', fetch })
    const tokens: string[] = []
    const full = await chat.stream([{ role: 'user', content: 'q' }], d => tokens.push(d))
    expect(full).toBe('片段完成')
    expect(tokens).toEqual(['片段', '完成'])
  })

  it('throws on non-200', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response('nope', { status: 500 }))
    const chat = createAiChat({ apiKey: 'k', fetch })
    await expect(chat.stream([{ role: 'user', content: 'q' }], () => {})).rejects.toThrow(/DeepSeek.*500/)
  })

  it('decodes a multibyte UTF-8 char split across two reads (stream flag)', async () => {
    const line = 'data: {"choices":[{"delta":{"content":"片段"}}]}\n\ndata: [DONE]\n\n'
    const bytes = new TextEncoder().encode(line)
    const cut = bytes.indexOf(0xe7) + 1 // split inside the first byte of '片' (E7 89 87)
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, cut))
          controller.enqueue(bytes.slice(cut))
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    })
    const chat = createAiChat({ apiKey: 'k', fetch })
    const tokens: string[] = []
    const full = await chat.stream([{ role: 'user', content: 'q' }], d => tokens.push(d))
    expect(full).toBe('片段')
    expect(tokens).toEqual(['片段'])
  })

  it('delivers reasoning_content with kind=reasoning, excluded from the returned text', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"让我想想…"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"核心是X。"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"是X"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    )
    const chat = createAiChat({ apiKey: 'k', fetch })
    const events: Array<[string, string]> = []
    const full = await chat.stream([{ role: 'user', content: 'q' }], (d, kind) => events.push([kind, d]))
    expect(events).toEqual([
      ['reasoning', '让我想想…'],
      ['reasoning', '核心是X。'],
      ['content', '答案'],
      ['content', '是X'],
    ])
    expect(full).toBe('答案是X')
    const body = JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.thinking).toBeUndefined() // 统一 deepseek-chat，不发 thinking
  })
})
