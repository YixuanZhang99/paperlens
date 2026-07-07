import { useEffect, useState } from 'react'
import type { Paper, ZoteroCollection } from '@shared/types'

export function LibraryView({ onSelect, selectedKey }: { onSelect: (p: Paper) => void; selectedKey: string | null }) {
  const [collections, setCollections] = useState<ZoteroCollection[]>([])
  const [selectedCol, setSelectedCol] = useState<string | null>(null)
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)
  const [treeOpen, setTreeOpen] = useState(false) // 文件夹树默认收起，让论文顶在上方
  const [filter, setFilter] = useState('') // 论文即时筛选（标题/作者/年份）

  useEffect(() => {
    // 文件夹加载失败不阻塞论文列表（无 collections 时仅显示「全部论文」）
    window.api.listCollections().then(setCollections).catch(() => {})
  }, [])

  useEffect(() => {
    setError(null)
    window.api.listPapers(selectedCol).then(setPapers).catch(() => setError('加载失败，请检查 Zotero 配置'))
  }, [selectedCol])

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
