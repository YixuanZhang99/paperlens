import { useEffect, useState } from 'react'
import type { Paper, ZoteroCollection } from '@shared/types'

export function LibraryView({ onSelect, selectedKey }: { onSelect: (p: Paper) => void; selectedKey: string | null }) {
  const [collections, setCollections] = useState<ZoteroCollection[]>([])
  const [selectedCol, setSelectedCol] = useState<string | null>(null)
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)
  const [treeOpen, setTreeOpen] = useState(false) // 文件夹树默认收起，让论文顶在上方
  const [filter, setFilter] = useState('') // 论文即时筛选（标题/作者/年份）
  // 一次性迁移(L1)：空库时提供「从 PaperLens/Zotero 迁移」入口
  const [mig, setMig] = useState<{ hasPaperLens: boolean; zoteroConfigured: boolean; paperCount: number } | null>(null)
  const [migRunning, setMigRunning] = useState(false)
  const [migProg, setMigProg] = useState('')
  const [migDone, setMigDone] = useState<{ fromPaperLens: boolean; zoteroConfigured: boolean; papers: number; pdfs: number; pdfMissing: number } | null>(null)

  useEffect(() => {
    // 文件夹加载失败不阻塞论文列表（无 collections 时仅显示「全部论文」）
    window.api.listCollections().then(setCollections).catch(() => {})
    window.api.migrateStatus().then(setMig).catch(() => {})
  }, [])

  useEffect(() => {
    setError(null)
    window.api.listPapers(selectedCol).then(setPapers).catch(() => setError('文献库加载失败'))
  }, [selectedCol])

  async function runMigrate() {
    setMigRunning(true)
    setError(null)
    try {
      const r = await window.api.migrateRun((phase, done, total, label) =>
        setMigProg(`${phase === 'paperlens' ? '搬迁 PaperLens 数据' : '导入 Zotero 文献'}：${done}/${total} ${label}`))
      setMigDone(r)
      window.api.listCollections().then(setCollections).catch(() => {})
      setPapers(await window.api.listPapers(selectedCol))
      window.api.migrateStatus().then(setMig).catch(() => {})
    } catch (e) {
      setError('迁移失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setMigRunning(false)
      setMigProg('')
    }
  }

  const childrenOf = (key: string | null) => collections.filter(c => c.parentKey === key)
  const hasFolders = collections.length > 0
  const currentName = selectedCol === null ? '全部论文' : (collections.find(c => c.key === selectedCol)?.name ?? '全部论文')

  // 即时筛选：标题 / 作者 / 年份，大小写不敏感
  const q = filter.trim().toLowerCase()
  const shown = q
    ? papers.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.authors.join(', ').toLowerCase().includes(q) ||
        String(p.year ?? '').includes(q))
    : papers

  // 选择文件夹后自动收起树，论文立即弹到上方
  const pickCol = (key: string | null) => { setSelectedCol(key); setTreeOpen(false) }

  function renderFolder(c: ZoteroCollection, depth: number) {
    const kids = childrenOf(c.key)
    return (
      <li key={c.key}>
        <button
          className={'folder-row' + (selectedCol === c.key ? ' selected' : '')}
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={() => pickCol(c.key)}
        >
          <span className="folder-icon">{selectedCol === c.key ? '📂' : '📁'}</span>{c.name}
        </button>
        {kids.length > 0 && <ul className="folder-children">{kids.map(k => renderFolder(k, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="library">
      {/* 当前文件夹（一行）：点击展开/收起文件夹树 */}
      <button
        className={'folder-current' + (treeOpen ? ' open' : '')}
        onClick={() => hasFolders && setTreeOpen(o => !o)}
        disabled={!hasFolders}
        title={hasFolders ? '切换文件夹' : undefined}
      >
        <span className="folder-current-name">
          <span className="folder-icon">{selectedCol === null ? '📚' : '📂'}</span>{currentName}
        </span>
        {hasFolders && <span className="folder-chevron">▾</span>}
      </button>
      {treeOpen && (
        <ul className="folder-tree">
          <li>
            <button
              className={'folder-row' + (selectedCol === null ? ' selected' : '')}
              onClick={() => pickCol(null)}
            >
              <span className="folder-icon">📚</span>全部论文
            </button>
          </li>
          {childrenOf(null).map(c => renderFolder(c, 0))}
        </ul>
      )}
      {papers.length > 0 && (
        <div className="lib-filter">
          <span className="lib-filter-icon">🔍</span>
          <input
            className="lib-filter-input"
            placeholder="筛选论文（标题 / 作者 / 年份）"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          {filter && <button className="lib-filter-clear" aria-label="清除筛选" onClick={() => setFilter('')}>×</button>}
        </div>
      )}
      <div className="lib-section">论文{shown.length > 0 ? ` · ${shown.length}` : ''}{q && papers.length > 0 ? ` / ${papers.length}` : ''}</div>
      {error ? (
        <div role="alert" className="alert-banner" style={{ margin: 12 }}>{error}</div>
      ) : papers.length === 0 && selectedCol === null ? (
        <div className="lib-migrate">
          <p className="lib-migrate-title">文献库是空的</p>
          {mig?.hasPaperLens && <p className="empty-hint">检测到旧 PaperLens 的数据（笔记/高亮/对话/知识库索引），可一键搬入。</p>}
          {mig && !mig.zoteroConfigured && (
            <p className="empty-hint">如需导入 Zotero 文献，请先到「设置」填写 Zotero User ID 与 API Key（以及本地数据目录）。</p>
          )}
          <button className="btn-primary" onClick={runMigrate} disabled={migRunning}>
            {migRunning
              ? '迁移中…'
              : mig?.hasPaperLens
                ? '🚚 一键迁移（PaperLens 数据 + Zotero 文献）'
                : '📥 从 Zotero 导入文献'}
          </button>
          {migRunning && migProg && <p className="empty-hint">{migProg}</p>}
          {migDone && (
            <p className="empty-hint">
              迁移完成：{migDone.fromPaperLens ? '已搬入 PaperLens 数据；' : ''}
              {migDone.zoteroConfigured
                ? `导入 ${migDone.papers} 篇（PDF ${migDone.pdfs} 份${migDone.pdfMissing ? `，缺失 ${migDone.pdfMissing} 份` : ''}）`
                : 'Zotero 未配置，未导入文献'}
            </p>
          )}
        </div>
      ) : (
        <ul className="paper-list">
          {papers.length === 0 && <li className="empty-hint" style={{ padding: '8px 12px' }}>此文件夹暂无论文</li>}
          {papers.length > 0 && shown.length === 0 && <li className="empty-hint" style={{ padding: '8px 12px' }}>无匹配论文</li>}
          {shown.map(p => (
            <li
              key={p.key}
              onClick={() => onSelect(p)}
              className={'paper-item' + (p.key === selectedKey ? ' selected' : '')}
            >
              <div className="paper-title">{p.title}</div>
              <div className="paper-meta">
                {p.authors.length > 0 && <span className="paper-authors-inline">{p.authors.join(', ')}</span>}
                {p.year ? <span className="paper-year">{p.year}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
