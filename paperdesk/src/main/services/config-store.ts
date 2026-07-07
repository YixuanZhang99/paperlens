import { AppConfigSchema, type AppConfig } from '@shared/types'

export interface ConfigCrypto {
  isEncryptionAvailable(): boolean
  encryptString(s: string): string
  decryptString(b: string): string
}
export interface ConfigFs {
  readFileSync(): string
  writeFileSync(path: string, data: string): void
  existsSync(): boolean
}
export interface ConfigStoreDeps {
  filePath: string
  fs: ConfigFs
  crypto: ConfigCrypto
}

export function createConfigStore(deps: ConfigStoreDeps) {
  function load(): AppConfig {
    if (!deps.fs.existsSync()) return AppConfigSchema.parse({})
    try {
      const raw = deps.fs.readFileSync()
      const json = deps.crypto.isEncryptionAvailable() ? deps.crypto.decryptString(raw) : raw
      return AppConfigSchema.parse(JSON.parse(json))
    } catch {
      return AppConfigSchema.parse({})
    }
  }

  let current = load()

  function get(): AppConfig {
    return current
  }

  function set(patch: Partial<AppConfig>): AppConfig {
    current = AppConfigSchema.parse({ ...current, ...patch })
    const json = JSON.stringify(current)
    const data = deps.crypto.isEncryptionAvailable() ? deps.crypto.encryptString(json) : json
    deps.fs.writeFileSync(deps.filePath, data)
    return current
  }

  return { get, set }
}
