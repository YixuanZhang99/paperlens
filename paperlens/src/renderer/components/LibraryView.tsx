import { useEffect, useState } from 'react'
import type { Paper, ZoteroCollection } from '@shared/types'

export function LibraryView({ onSelect, selectedKey }: { onSelect: (p: Paper) => void; selectedKey: string | null }) {
  const [collections, setCollections] = useState<ZoteroCollection[]>([])
  const [selectedCol, setSelectedCol] = useState<string | null>(null)
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 文件夹加载失败不阻塞论文列表（无 collections 时仅显示「全部论文」）
    window.api.listCollections().then(setCollections).catch(() => {})
  }, [])

  useEffect(() => {
    setError(null)
    window.api.listPapers(selectedCol).then(setPapers).catch(() => setError('加载失败，请检查 Zotero 配置'))
  }, [selectedCol])

  const childrenOf = (key: string | null) => collections.filter(c => c.parentKey === key)

  function renderFolder(c: ZoteroCollection, depth: number) {
    const kids = childrenOf(c.key)
    return (
      <li key={c.key}>
        <button
          className={'folder-row' + (selectedCol === c.key ? ' selected' : '')}
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={() => setSelectedCol(c.key)}
        >
          <span className="folder-icon">{selectedCol === c.key ? '📂' : '📁'}</span>{c.name}
        </button>
        {kids.length > 0 && <ul className="folder-children">{kids.map(k => renderFolder(k, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="library">
      <ul className="folder-tree">
        <li>
          <button
            className={'folder-row' + (selectedCol === null ? ' selected' : '')}
            onClick={() => setSelectedCol(null)}
          >
            <span className="folder-icon">📚</span>全部论文
          </button>
        </li>
        {childrenOf(null).map(c => renderFolder(c, 0))}
      </ul>
      <div className="lib-section">论文{papers.length > 0 ? ` · ${papers.length}` : ''}</div>
      {error ? (
        <div role="alert" className="alert-banner" style={{ margin: 12 }}>{error}</div>
      ) : (
        <ul className="paper-list">
          {papers.length === 0 && <li className="empty-hint" style={{ padding: '8px 12px' }}>此文件夹暂无论文</li>}
          {papers.map(p => (
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
