import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Paper } from '@shared/types'
import { LibraryView } from './components/LibraryView'
import { ReaderView } from './components/ReaderView'
import { ChatView } from './components/ChatView'
import { SettingsView } from './components/SettingsView'
import { KnowledgeView } from './components/KnowledgeView'

const readW = (k: string, d: number) => {
  const v = Number(localStorage.getItem(k))
  return Number.isFinite(v) && v >= 200 ? v : d
}

export function App() {
  const [selected, setSelected] = useState<Paper | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showKb, setShowKb] = useState(false)
  const [notesVersion, setNotesVersion] = useState(0)
  // 三栏宽度可拖拽、左右栏可收起；宽度与开合记忆到 localStorage
  const [navW, setNavW] = useState(() => readW('pl.navW', 290))
  const [chatW, setChatW] = useState(() => readW('pl.chatW', 430))
  const [navOpen, setNavOpen] = useState(() => localStorage.getItem('pl.navOpen') !== '0')
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem('pl.chatOpen') !== '0')

  // 启动静默增量索引：知识库「永远是新的」（失败忽略，不打扰用户）
  // 同时预取论文列表缓存，让知识库「打开论文」跳转即时（免去点击时的网络往返）
  const papersCache = useRef<Paper[]>([])
  useEffect(() => {
    window.api.kbIndex(() => {}).catch(() => {})
    window.api.listPapers().then(ps => { papersCache.current = ps }).catch(() => {})
  }, [])

  async function openPaperByKey(paperKey: string) {
    setShowKb(false)
    let p = papersCache.current.find(x => x.key === paperKey)
    if (!p) {
      papersCache.current = await window.api.listPapers().catch(() => [] as Paper[])
      p = papersCache.current.find(x => x.key === paperKey)
    }
    if (p) setSelected(p)
  }

  useEffect(() => {
    localStorage.setItem('pl.navW', String(navW))
    localStorage.setItem('pl.chatW', String(chatW))
    localStorage.setItem('pl.navOpen', navOpen ? '1' : '0')
    localStorage.setItem('pl.chatOpen', chatOpen ? '1' : '0')
  }, [navW, chatW, navOpen, chatOpen])

  useEffect(() => {
    if (!showSettings && !showKb) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowSettings(false); setShowKb(false) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showSettings, showKb])

  function startDrag(side: 'nav' | 'chat', e: ReactMouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const start = side === 'nav' ? navW : chatW
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      if (side === 'nav') setNavW(Math.min(480, Math.max(200, start + dx)))
      else setChatW(Math.min(680, Math.max(300, start - dx)))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `${navOpen ? navW : 30}px 5px 1fr 5px ${chatOpen ? chatW : 30}px` }}
    >
      <nav aria-label="论文库" className="pane-nav">
        {navOpen ? (
          <>
            <div className="nav-header">
              <span className="nav-brand">Paper<span className="accent">Lens</span></span>
              <div style={{ display: 'flex', gap: 2 }}>
                <button className="btn-ghost" onClick={() => setShowKb(true)}>🧠 知识库</button>
                <button className="btn-ghost" onClick={() => setShowSettings(true)}>⚙ 设置</button>
                <button className="btn-ghost pane-toggle" aria-label="收起论文库" onClick={() => setNavOpen(false)}>«</button>
              </div>
            </div>
            <div className="nav-scroll">
              <LibraryView onSelect={setSelected} selectedKey={selected?.key ?? null} />
            </div>
          </>
        ) : (
          <button className="rail-toggle" aria-label="展开论文库" onClick={() => setNavOpen(true)}>»</button>
        )}
      </nav>
      <div className="gutter" onMouseDown={e => startDrag('nav', e)} />
      <section aria-label="阅读" role="region" className="pane-reader">
        <ReaderView paper={selected} notesVersion={notesVersion} />
      </section>
      <div className="gutter" onMouseDown={e => startDrag('chat', e)} />
      <section aria-label="对话" role="region" className="pane-chat">
        {chatOpen ? (
          <>
            <div className="chat-top">
              <span>AI 对话</span>
              <button className="btn-ghost pane-toggle" aria-label="收起对话" onClick={() => setChatOpen(false)}>»</button>
            </div>
            <ChatView paper={selected} onNoteSaved={() => setNotesVersion(v => v + 1)} />
          </>
        ) : (
          <button className="rail-toggle" aria-label="展开对话" onClick={() => setChatOpen(true)}>«</button>
        )}
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
      {showKb && (
        <div className="modal-backdrop" onClick={() => setShowKb(false)}>
          <div role="dialog" aria-modal="true" aria-label="知识库" className="modal-panel" style={{ width: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <KnowledgeView onOpenPaper={openPaperByKey} />
          </div>
        </div>
      )}
    </div>
  )
}
