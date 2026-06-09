import { useEffect, useState } from 'react'
import type { AppConfig } from '@shared/types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const FIELDS: Array<{ key: keyof AppConfig; label: string; secret?: boolean }> = [
  { key: 'zoteroUserId', label: 'Zotero User ID' },
  { key: 'zoteroApiKey', label: 'Zotero API Key', secret: true },
  { key: 'deepseekApiKey', label: 'DeepSeek API Key', secret: true },
  { key: 'deepseekModel', label: 'DeepSeek Model' },
  { key: 'notionToken', label: 'Notion Token', secret: true },
  { key: 'notionDatabaseId', label: 'Notion Database ID' },
]

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { window.api.getConfig().then(setCfg) }, [])
  if (!cfg) return null

  return (
    <div style={{ padding: 16, display: 'grid', gap: 10, maxWidth: 480 }}>
      <h2>设置</h2>
      {error && <div role="alert" style={{ color: 'crimson', fontSize: 13 }}>{error}</div>}
      {FIELDS.map(f => (
        <label key={f.key} style={{ display: 'grid', gap: 4 }}>
          <span>{f.label}</span>
          <input
            type={f.secret ? 'password' : 'text'}
            value={cfg[f.key]}
            onChange={e => setCfg({ ...cfg, [f.key]: e.target.value })} />
        </label>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={async () => {
          setError(null)
          try { await window.api.setConfig(cfg); onClose() }
          catch (e) { setError('保存失败：' + errMsg(e)) }
        }}>保存</button>
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  )
}
