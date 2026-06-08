import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { migrate } from './services/db'
import { createConfigStore } from './services/config-store'
import { createNotesRepo } from './services/notes-repo'
import { createZoteroClient } from './services/zotero-client'
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

  // 工厂：按当前配置即时构造外部客户端（密钥可能随时被用户更新）
  const cfg = () => configStore.get()
  const zotero = () => createZoteroClient({ apiKey: cfg().zoteroApiKey, userId: cfg().zoteroUserId, fetch })
  const ai = () => createAiChat({ apiKey: cfg().deepseekApiKey, model: cfg().deepseekModel, fetch })
  const notion = () => createNotionSync({ token: cfg().notionToken, databaseId: cfg().notionDatabaseId, fetch })

  return { configStore, db, notesRepo, zotero, ai, notion }
}
export type Container = ReturnType<typeof createContainer>
