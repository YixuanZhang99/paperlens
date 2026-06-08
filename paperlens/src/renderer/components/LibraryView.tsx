import { useEffect, useState } from 'react'
import type { Paper } from '@shared/types'

export function LibraryView({ onSelect, selectedKey }: { onSelect: (p: Paper) => void; selectedKey: string | null }) {
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listPapers().then(setPapers).catch(() => setError('加载失败，请检查 Zotero 配置'))
  }, [])

  if (error) return <div role="alert" style={{ padding: 12, color: 'crimson' }}>{error}</div>
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {papers.map(p => (
        <li key={p.key}
            onClick={() => onSelect(p)}
            style={{ padding: '10px 12px', cursor: 'pointer', background: p.key === selectedKey ? '#eef' : undefined }}>
          <div style={{ fontWeight: 600 }}>{p.title}</div>
          <div style={{ fontSize: 12, color: '#666' }}>{p.authors.join(', ')} · {p.year ?? ''}</div>
        </li>
      ))}
    </ul>
  )
}
