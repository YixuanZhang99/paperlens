import { useEffect, useState } from 'react'
import type { Paper } from '@shared/types'
import { LibraryView } from './components/LibraryView'
import { ReaderView } from './components/ReaderView'
import { ChatView } from './components/ChatView'
import { SettingsView } from './components/SettingsView'

export function App() {
  const [selected, setSelected] = useState<Paper | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [notesVersion, setNotesVersion] = useState(0)

  useEffect(() => {
    if (!showSettings) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSettings(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showSettings])

  return (
    <div className="app">
      <nav aria-label="论文库" className="pane-nav">
        <div className="nav-header">
          <span className="nav-brand">Paper<span className="accent">Lens</span></span>
          <button className="btn-ghost" onClick={() => setShowSettings(true)}>⚙ 设置</button>
        </div>
        <div className="nav-scroll">
          <LibraryView onSelect={setSelected} selectedKey={selected?.key ?? null} />
        </div>
      </nav>
      <section aria-label="阅读" role="region" className="pane-reader">
        <ReaderView paper={selected} notesVersion={notesVersion} />
      </section>
      <section aria-label="对话" role="region" className="pane-chat">
        <ChatView paper={selected} onNoteSaved={() => setNotesVersion(v => v + 1)} />
      </section>
      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="设置"
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <SettingsView onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
