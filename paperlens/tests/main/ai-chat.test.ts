import { describe, it, expect, vi } from 'vitest'
import { createAiChat } from '../../src/main/services/ai-chat'
import type { ChatMessage } from '@shared/types'

describe('createAiChat.complete', () => {
  it('posts to deepseek with bearer auth and returns assistant text', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '这篇论文提出了Transformer。' } }],
      }), { status: 200 })
    )
    const chat = createAiChat({ apiKey: 'sk-x', model: 'deepseek-chat', fetch })
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const reply = await chat.complete(msgs)

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect((init!.headers as any)['Authorization']).toBe('Bearer sk-x')
    const body = JSON.parse(init!.body as string)
    expect(body.model).toBe('deepseek-chat')
    expect(body.messages).toEqual(msgs)
    expect(reply).toBe('这篇论文提出了Transformer。')
  })

  it('throws on non-200', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response('nope', { status: 401 }))
    const chat = createAiChat({ apiKey: 'bad', model: 'deepseek-chat', fetch })
    await expect(chat.complete([{ role: 'user', content: 'x' }])).rejects.toThrow(/DeepSeek.*401/)
  })
})
