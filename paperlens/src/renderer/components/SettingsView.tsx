import { useEffect, useState } from 'react'
import type { AppConfig } from '@shared/types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const FIELDS: Array<{ key: keyof AppConfig; label: string; secret?: boolean; provider?: 'deepseek' | 'kimi' }> = [
  { key: 'zoteroUserId', label: 'Zotero User ID' },
  { key: 'zoteroApiKey', label: 'Zotero API Key', secret: true },
  { key: 'zoteroDataDir', label: 'Zotero 数据目录（留空=默认 ~/Zotero）' },
  { key: 'deepseekApiKey', label: 'DeepSeek API Key', secret: true, provider: 'deepseek' },
  { key: 'deepseekModel', label: 'DeepSeek Model', provider: 'deepseek' },
  { key: 'kimiApiKey', label: 'Kimi API Key（platform.moonshot.cn 获取）', secret: true, provider: 'kimi' },
  { key: 'kimiModel', label: 'Kimi 模型（如 moonshot-v1-32k / kimi-k2-…）', provider: 'kimi' },
  { key: 'kimiBaseUrl', label: 'Kimi 接口地址（默认 https://api.moonshot.cn/v1；海外用 .ai）', provider: 'kimi' },
  { key: 'notionToken', label: 'Notion Token', secret: true },
  { key: 'notionDatabaseId', label: 'Notion Database ID' },
]

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { window.api.getConfig().then(setCfg) }, [])
  if (!cfg) return null

  return (
    <div className="settings">
      <h2>设置</h2>
      {error && <div role="alert" className="alert-banner">{error}</div>}
      <label>
        <span>AI 提供商（对话 / 综述 / 精读）</span>
        <select
          value={cfg.aiProvider}
          onChange={e => setCfg({ ...cfg, aiProvider: e.target.value as AppConfig['aiProvider'] })}>
          <option value="deepseek">DeepSeek</option>
          <option value="kimi">Kimi（Moonshot）</option>
        </select>
      </label>
      {FIELDS.map(f => {
        // 非当前提供商的字段淡化提示（仍可填，方便两边都配好随时切）
        const dim = f.provider && f.provider !== cfg.aiProvider
        return (
          <label key={f.key} style={dim ? { opacity: 0.55 } : undefined}>
            <span>{f.label}{f.provider === cfg.aiProvider ? ' ·使用中' : ''}</span>
            <input
              type={f.secret ? 'password' : 'text'}
              value={cfg[f.key] ?? ''}
              onChange={e => setCfg({ ...cfg, [f.key]: e.target.value })} />
          </label>
        )
      })}
      <div className="settings-actions">
        <button className="btn-primary" onClick={async () => {
          setError(null)
          try { await window.api.setConfig(cfg); onClose() }
          catch (e) { setError('保存失败：' + errMsg(e)) }
        }}>保存</button>
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  )
}
