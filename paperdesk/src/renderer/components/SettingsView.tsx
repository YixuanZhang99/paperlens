import { useEffect, useState } from 'react'
import type { AppConfig } from '@shared/types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// 文献库信息区块(L4)：数据目录展示 + 打开(便于手动备份)
function LibrarySection() {
  const [info, setInfo] = useState<{ dataDir: string; papers: number } | null>(null)
  useEffect(() => { window.api.libraryInfo().then(setInfo).catch(() => {}) }, [])
  return (
    <div className="settings-group">
      <div className="settings-group-title">🗂 文献库（本地自管）</div>
      <div className="settings-field">
        <small className="settings-hint">
          {info ? `共 ${info.papers} 篇论文；数据与 PDF 存于：${info.dataDir}` : '加载中…'}
        </small>
        <button style={{ justifySelf: 'start' }} onClick={() => window.api.openLibraryDir()}>打开数据目录（便于备份）</button>
      </div>
    </div>
  )
}

type Field = { key: keyof AppConfig; label: string; secret?: boolean; hint?: string }

const ZOTERO_FIELDS: Field[] = [
  { key: 'zoteroUserId', label: 'User ID' },
  { key: 'zoteroApiKey', label: 'API Key', secret: true, hint: '只读权限即可（仅迁移导入用）' },
  { key: 'zoteroDataDir', label: '数据目录', hint: '留空 = 默认 ~/Zotero' },
]
const DEEPSEEK_FIELDS: Field[] = [
  { key: 'deepseekApiKey', label: 'DeepSeek API Key', secret: true, hint: 'platform.deepseek.com 获取（模型固定 deepseek-chat）' },
]
const KIMI_FIELDS: Field[] = [
  { key: 'kimiApiKey', label: 'Kimi API Key', secret: true, hint: 'Kimi Code：kimi.com/code 控制台；Moonshot：platform.moonshot.cn' },
  { key: 'kimiModel', label: '模型', hint: 'Kimi Code 填 kimi-for-coding；Moonshot 填 moonshot-v1-32k 等' },
  { key: 'kimiBaseUrl', label: '接口地址', hint: 'Kimi Code：https://api.kimi.com/coding/v1；Moonshot：https://api.moonshot.cn/v1' },
]
const NOTION_FIELDS: Field[] = [
  { key: 'notionToken', label: 'Integration Token', secret: true },
  { key: 'notionDatabaseId', label: 'Database ID' },
]

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { window.api.getConfig().then(setCfg) }, [])
  if (!cfg) return null

  const renderField = (f: Field) => (
    <div className="settings-field" key={f.key}>
      <label>
        <span>{f.label}</span>
        <input
          type={f.secret ? 'password' : 'text'}
          value={(cfg[f.key] as string) ?? ''}
          onChange={e => setCfg({ ...cfg, [f.key]: e.target.value })} />
      </label>
      {f.hint && <small className="settings-hint">{f.hint}</small>}
    </div>
  )

  return (
    <div className="settings">
      <h2>设置</h2>
      {error && <div role="alert" className="alert-banner">{error}</div>}

      <LibrarySection />

      <div className="settings-group">
        <div className="settings-group-title">📥 从 Zotero 导入（一次性，迁移用）</div>
        {ZOTERO_FIELDS.map(renderField)}
      </div>

      <div className="settings-group">
        <div className="settings-group-title">🤖 AI 助手（对话 / 综述 / 精读）</div>
        <div className="seg" role="tablist" aria-label="AI 提供商">
          {(['deepseek', 'kimi'] as const).map(p => (
            <button
              key={p}
              className={'seg-btn' + (cfg.aiProvider === p ? ' active' : '')}
              onClick={() => setCfg({ ...cfg, aiProvider: p })}
            >{p === 'deepseek' ? 'DeepSeek' : 'Kimi'}</button>
          ))}
        </div>
        {(cfg.aiProvider === 'kimi' ? KIMI_FIELDS : DEEPSEEK_FIELDS).map(renderField)}
      </div>

      <div className="settings-group">
        <div className="settings-group-title">🔎 知识库语义检索</div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={cfg.semanticSearch !== false}
            onChange={e => setCfg({ ...cfg, semanticSearch: e.target.checked })} />
          <span>启用语义向量检索（本地小模型，首次更新索引时下载约 30MB；关闭则仅用关键词）</span>
        </label>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">🔗 Notion 同步（可选）</div>
        {NOTION_FIELDS.map(renderField)}
      </div>

      <div className="settings-actions">
        <button className="btn-primary" disabled={saving} onClick={async () => {
          setError(null); setSaving(true)
          try { await window.api.setConfig(cfg); onClose() }
          catch (e) { setError('保存失败：' + errMsg(e)) }
          finally { setSaving(false) }
        }}>{saving ? '保存中…' : '保存'}</button>
        <button onClick={onClose} disabled={saving}>取消</button>
      </div>
    </div>
  )
}
