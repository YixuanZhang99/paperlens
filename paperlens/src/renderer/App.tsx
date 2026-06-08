import { useState } from 'react'
import type { Paper } from '@shared/types'
import { LibraryView } from './components/LibraryView'
import { ReaderView } from './components/ReaderView'
import { ChatView } from './components/ChatView'
import { SettingsView } from './components/SettingsView'

export function App() {
  const [selected, setSelected] = useState<Paper | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 420px', height: '100vh' }}>
      <nav aria-label="论文库" style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #ddd', overflow: 'hidden' }}>
        <div style={{ padding: 8, borderBottom: '1px solid #eee' }}>
          <button onClick={() => setShowSettings(true)}>⚙ 设置</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <LibraryView onSelect={setSelected} selectedKey={selected?.key ?? null} />
        </div>
      </nav>
      <section aria-label="阅读" role="region" style={{ overflow: 'auto' }}>
        <ReaderView paper={selected} />
      </section>
      <section aria-label="对话" role="region" style={{ overflow: 'auto', borderLeft: '1px solid #ddd' }}>
        <ChatView paper={selected} />
      </section>
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 8, maxHeight: '90vh', overflow: 'auto' }}>
            <SettingsView onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
