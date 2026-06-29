import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { migrate } from './services/db'
import { createConfigStore } from './services/config-store'
import { createNotesRepo } from './services/notes-repo'
import { createChatRepo } from './services/chat-repo'
import { createHighlightsRepo } from './services/highlights-repo'
import { createZoteroClient } from './services/zotero-client'
import { createZoteroLocal } from './services/zotero-local'
import { createAiChat } from './services/ai-chat'
import { createNotionSync } from './services/notion-sync'

export function createContainer() {
  const userData = app.getPath('userData')
  const configPath = join(userData, 'config.enc')

  const configStore = createConfigStore({
    filePath: configPath,
    fs: {
      existsSync: () => fs.existsSync(configPath),
      readFileSync: () => fs.readFileSync(configPath, 'utf8'),
      writeFileSync: (p, d) => fs.writeFileSync(p, d, 'utf8'),
    },
    crypto: {
      // NOTE: when the OS keychain is unavailable (e.g. some Linux setups),
      // safeStorage.isEncryptionAvailable() returns false and config — including
      // API secrets — is persisted as PLAINTEXT JSON. This is an intentional
      // fallback (persisting is better than failing); it is symmetric on read.
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s) => safeStorage.encryptString(s).toString('base64'),
      decryptString: (b) => safeStorage.decryptString(Buffer.from(b, 'base64')),
    },
  })

  const db = new Database(join(userData, 'paperlens.db'))
  migrate(db)
  const notesRepo = createNotesRepo({
    db,
    now: () => Date.now(),
    genId: () => randomUUID(),
  })
  const chatRepo = createChatRepo(db)
  const highlightsRepo = createHighlightsRepo({
    db,
    now: () => Date.now(),
    genId: () => randomUUID(),
  })

  // 工厂：按当前配置即时构造外部客户端（密钥可能随时被用户更新）
  const cfg = () => configStore.get()
  const zotero = () => createZoteroClient({ apiKey: cfg().zoteroApiKey, userId: cfg().zoteroUserId, fetch })
  // AI 后端：按配置在 DeepSeek / Kimi(Moonshot) 间切换（均 OpenAI 兼容接口）
  const ai = (opts?: { deepThink?: boolean }) => {
    const c = cfg()
    if (c.aiProvider === 'kimi') {
      return createAiChat({
        apiKey: c.kimiApiKey,
        model: c.kimiModel || 'moonshot-v1-32k',
        baseUrl: c.kimiBaseUrl || 'https://api.moonshot.cn/v1',
        fetch,
        deepThink: opts?.deepThink,
      })
    }
    return createAiChat({ apiKey: c.deepseekApiKey, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', fetch, deepThink: opts?.deepThink })
  }
  const notion = () => createNotionSync({ token: cfg().notionToken, databaseId: cfg().notionDatabaseId, fetch })
  const zoteroLocal = () => createZoteroLocal({
    dataDir: cfg().zoteroDataDir || join(os.homedir(), 'Zotero'),
    exists: (p) => fs.existsSync(p),
    readFile: (p) => new Uint8Array(fs.readFileSync(p)),
    readdir: (p) => fs.readdirSync(p),
    join: (...parts) => join(...parts),
  })

  return { configStore, db, notesRepo, chatRepo, highlightsRepo, zotero, ai, notion, zoteroLocal }
}
export type Container = ReturnType<typeof createContainer>
