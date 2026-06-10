import { useEffect, useState } from 'react'
import type { Paper } from '@shared/types'

export function LibraryView({ onSelect, selectedKey }: { onSelect: (p: Paper) => void; selectedKey: string | null }) {
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listPapers().then(setPapers).catch(() => setError('加载失败，请检查 Zotero 配置'))
  }, [])

  if (error) return <div role="alert" className="alert-banner" style={{ margin: 12 }}>{error}</div>
  return (
    <ul className="paper-list">
      {papers.map(p => (
        <li
          key={p.key}
          onClick={() => onSelect(p)}
          className={'paper-item' + (p.key === selectedKey ? ' selected' : '')}
        >
          <div className="paper-title">{p.title}</div>
          <div className="paper-meta">{p.authors.join(', ')}{p.year ? ` · ${p.year}` : ''}</div>
        </li>
      ))}
    </ul>
  )
}
