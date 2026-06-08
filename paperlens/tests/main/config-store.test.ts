import { describe, it, expect } from 'vitest'
import { createConfigStore } from '../../src/main/services/config-store'

function fakeBackend() {
  let stored: string | null = null
  return {
    fs: {
      readFileSync: () => { if (stored === null) throw new Error('ENOENT'); return stored },
      writeFileSync: (_p: string, data: string) => { stored = data },
      existsSync: () => stored !== null,
    },
    // 假加密：base64，便于断言「不是明文」
    crypto: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s).toString('base64'),
      decryptString: (b: string) => Buffer.from(b, 'base64').toString('utf8'),
    },
  }
}

describe('ConfigStore', () => {
  it('returns schema defaults when nothing saved', () => {
    const { fs, crypto } = fakeBackend()
    const store = createConfigStore({ filePath: '/x', fs, crypto })
    expect(store.get().deepseekModel).toBe('deepseek-chat')
    expect(store.get().zoteroApiKey).toBe('')
  })

  it('persists encrypted and round-trips on reload', () => {
    const backend = fakeBackend()
    const store = createConfigStore({ filePath: '/x', fs: backend.fs, crypto: backend.crypto })
    store.set({ zoteroApiKey: 'secret', zoteroUserId: '42' })

    // 落盘内容不是明文
    const raw = backend.fs.readFileSync()
    expect(raw).not.toContain('secret')

    // 新实例读回
    const store2 = createConfigStore({ filePath: '/x', fs: backend.fs, crypto: backend.crypto })
    expect(store2.get().zoteroApiKey).toBe('secret')
    expect(store2.get().zoteroUserId).toBe('42')
    expect(store2.get().deepseekModel).toBe('deepseek-chat') // 未设置项保留默认
  })
})
