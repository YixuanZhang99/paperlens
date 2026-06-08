import { useState } from 'react'
import type { Paper } from '@shared/types'
import { LibraryView } from './components/LibraryView'
import { ReaderView } from './components/ReaderView'
import { ChatView } from './components/ChatView'

export function App() {
  const [selected, setSelected] = useState<Paper | null>(null)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 420px', height: '100vh' }}>
      <nav aria-label="论文库" style={{ overflow: 'auto', borderRight: '1px solid #ddd' }}>
        <LibraryView onSelect={setSelected} selectedKey={selected?.key ?? null} />
      </nav>
      <section aria-label="阅读" role="region" style={{ overflow: 'auto' }}>
        <ReaderView paper={selected} />
      </section>
      <section aria-label="对话" role="region" style={{ overflow: 'auto', borderLeft: '1px solid #ddd' }}>
        <ChatView paper={selected} />
      </section>
    </div>
  )
}
