import { useEffect, useState } from 'react'
import type { Paper, ZoteroCollection } from '@shared/types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// 入库弹窗(L2)：贴 DOI/arXiv 号自动拉元数据(arXiv 顺带下 PDF)、拖 PDF 猜标题、手动填写兜底。
// 不自动关闭——可连续添加,「完成」退出;每次成功通过 onAdded 让父组件刷新并选中新论文。
function AddPaperModal({ onClose, onAdded }: { onClose: () => void; onAdded: (p: Paper) => void }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [mTitle, setMTitle] = useState('')
  const [mAuthors, setMAuthors] = useState('')
  const [mYear, setMYear] = useState('')
  const [draft, setDraft] = useState<{ bytes: ArrayBuffer; title: string; filename: string } | null>(null)

  async function addByRef() {
    if (!input.trim() || busy) return
    setBusy(true); setErr(null); setOk(null)
    try {
      const r = await window.api.addPaperByRef(input.trim())
      setOk(`已加入「${r.paper.title}」${r.pdf ? '（PDF 已自动下载）' : '（未获取到 PDF，可拖入补上）'}`)
      setInput('')
      onAdded(r.paper)
    } catch (e) {
      setErr(errMsg(e))
      setManualOpen(true) // 拉取失败 → 展开手动兜底
    } finally { setBusy(false) }
  }

  async function pickPdf(file: File) {
    setErr(null); setOk(null); setBusy(true)
    try {
      const bytes = await file.arrayBuffer()
      const { titleGuess } = await window.api.sniffPdf(bytes)
      setDraft({ bytes, title: titleGuess || file.name.replace(/\.pdf$/i, ''), filename: file.name })
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  async function addDraft() {
    if (!draft || !draft.title.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      const p = await window.api.addPaperManual({ title: draft.title.trim(), authors: [], year: null, abstract: '' })
      await window.api.attachPaperPdf(p.key, draft.bytes)
      setOk(`已加入「${p.title}」（含 PDF）`)
      setDraft(null)
      onAdded(p)
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  async function addManual() {
    if (!mTitle.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      const p = await window.api.addPaperManual({
        title: mTitle.trim(),
        authors: mAuthors.split(/[,，]/).map(s => s.trim()).filter(Boolean),
        year: mYear.trim() ? Number(mYear.trim()) : null,
        abstract: '',
      })
      setOk(`已加入「${p.title}」（无 PDF，可拖入补上）`)
      setMTitle(''); setMAuthors(''); setMYear('')
      onAdded(p)
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel add-paper" role="dialog" aria-modal="true" aria-label="添加论文" onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>＋ 添加论文</h3>
        <div className="add-row">
          <input
            placeholder="粘贴 DOI / arXiv 编号或链接，如 2405.12345"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addByRef() }} />
          <button className="btn-primary" onClick={addByRef} disabled={busy || !input.trim()}>{busy ? '处理中…' : '获取并加入'}</button>
        </div>
        <div
          className="add-drop"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pickPdf(f) }}>
          把 PDF 拖到这里，或
          <label className="add-file-btn">
            选择 PDF 文件
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) pickPdf(f); e.currentTarget.value = '' }} />
          </label>
        </div>
        {draft && (
          <div className="add-draft">
            <span className="empty-hint">已读取 {draft.filename}，确认标题：</span>
            <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
            <button className="btn-primary" onClick={addDraft} disabled={busy || !draft.title.trim()}>加入文献库</button>
          </div>
        )}
        {err && <div role="alert" className="alert-banner">{err}</div>}
        {ok && <p className="empty-hint" style={{ margin: 0 }}>✓ {ok}</p>}
        <button className="btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setManualOpen(o => !o)}>
          {manualOpen ? '收起手动填写' : '手动填写元数据'}
        </button>
        {manualOpen && (
          <div className="add-manual">
            <input placeholder="标题（必填）" value={mTitle} onChange={e => setMTitle(e.target.value)} />
            <input placeholder="作者（逗号分隔，可空）" value={mAuthors} onChange={e => setMAuthors(e.target.value)} />
            <input placeholder="年份（可空）" value={mYear} onChange={e => setMYear(e.target.value)} />
            <button className="btn-primary" onClick={addManual} disabled={busy || !mTitle.trim()}>加入文献库</button>
          </div>
        )}
        <div className="add-foot"><button onClick={onClose}>完成</button></div>
      </div>
    </div>
  )
}

// 论文编辑弹窗(L3)：元数据 + 文件夹归属 + 删除(级联)合一
function EditPaperModal({ paper, folders, onClose, onSaved, onDeleted }: {
  paper: Paper
  folders: ZoteroCollection[]
  onClose: () => void
  onSaved: (updated: Paper) => void
  onDeleted: (key: string) => void
}) {
  const [title, setTitle] = useState(paper.title)
  const [authors, setAuthors] = useState(paper.authors.join(', '))
  const [year, setYear] = useState(paper.year ? String(paper.year) : '')
  const [abstract, setAbstract] = useState(paper.abstract)
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    window.api.getPaperFolders(paper.key).then(ids => setMemberIds(new Set(ids))).catch(() => {})
  }, [paper.key])

  const toggleFolder = (id: string) =>
    setMemberIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function save() {
    if (!title.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      const parsedAuthors = authors.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      const parsedYear = year.trim() ? Number(year.trim()) : null
      await window.api.updatePaper({
        key: paper.key, title: title.trim(), authors: parsedAuthors, year: parsedYear, abstract,
      })
      await window.api.setPaperFolders(paper.key, [...memberIds])
      // 回传更新后的对象:父组件据此刷新 App.selected,阅读器/对话标题即时生效
      onSaved({ ...paper, title: title.trim(), authors: parsedAuthors, year: parsedYear, abstract })
      onClose()
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  async function del() {
    if (!confirmDel) { setConfirmDel(true); return }
    setBusy(true); setErr(null)
    try {
      await window.api.deletePaper(paper.key)
      onDeleted(paper.key)
      onClose()
    } catch (e) { setErr(errMsg(e)); setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel edit-paper" role="dialog" aria-modal="true" aria-label="编辑论文" onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>✎ 编辑论文</h3>
        <input placeholder="标题（必填）" value={title} onChange={e => setTitle(e.target.value)} />
        <input placeholder="作者（逗号分隔）" value={authors} onChange={e => setAuthors(e.target.value)} />
        <input placeholder="年份" value={year} onChange={e => setYear(e.target.value)} />
        <textarea placeholder="摘要" rows={3} value={abstract} onChange={e => setAbstract(e.target.value)} />
        {folders.length > 0 && (
          <div className="edit-folders">
            <div className="edit-folders-title">所属文件夹</div>
            <div className="edit-folders-list">
              {folders.map(f => (
                <label key={f.key} className="edit-folder-check">
                  <input type="checkbox" checked={memberIds.has(f.key)} onChange={() => toggleFolder(f.key)} />
                  <span>{f.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {err && <div role="alert" className="alert-banner">{err}</div>}
        <div className="edit-foot">
          <button className={confirmDel ? 'btn-danger' : ''} onClick={del} disabled={busy}>
            {confirmDel ? '确认删除？将同时删除其笔记/高亮/对话与索引' : '删除论文'}
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} disabled={busy}>取消</button>
          <button className="btn-primary" onClick={save} disabled={busy || !title.trim()}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  )
}

export function LibraryView({ onSelect, selectedKey, onDeleted }: { onSelect: (p: Paper) => void; selectedKey: string | null; onDeleted?: (key: string) => void }) {
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
  const [showAdd, setShowAdd] = useState(false)
  // 管理(L3)
  const [editPaper, setEditPaper] = useState<Paper | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDelFolder, setConfirmDelFolder] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const refreshFolders = () => window.api.listCollections().then(setCollections).catch(() => {})
  const refreshPapers = async () => {
    try { setPapers(await window.api.listPapers(selectedCol)) }
    catch { /* 刷新失败保持现有列表,避免误显「文献库是空的」迁移引导 */ }
  }

  async function submitRename(id: string) {
    if (!renameVal.trim()) { setRenamingId(null); return }
    try { await window.api.renameFolder(id, renameVal.trim()); refreshFolders() }
    catch (e) { setError('重命名失败：' + errMsg(e)) }
    setRenamingId(null)
  }

  async function removeFolder(id: string) {
    if (confirmDelFolder !== id) { setConfirmDelFolder(id); return }
    setConfirmDelFolder(null)
    try {
      await window.api.deleteFolder(id)
      if (selectedCol === id) setSelectedCol(null)
      refreshFolders()
    } catch (e) { setError('删除文件夹失败：' + errMsg(e)) }
  }

  async function submitNewFolder() {
    if (!newFolderName.trim()) { setCreatingFolder(false); return }
    try {
      // 当前选中某文件夹时建为其子级,否则建到顶层
      await window.api.addFolder({ name: newFolderName.trim(), parentId: selectedCol })
      refreshFolders()
    } catch (e) { setError('新建文件夹失败：' + errMsg(e)) }
    setNewFolderName(''); setCreatingFolder(false)
  }

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
        {renamingId === c.key ? (
          <div className="folder-line" style={{ paddingLeft: 12 + depth * 16 }}>
            <input
              className="folder-rename-input"
              autoFocus
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitRename(c.key)
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onBlur={() => submitRename(c.key)} />
          </div>
        ) : (
          <div className="folder-line">
            <button
              className={'folder-row' + (selectedCol === c.key ? ' selected' : '')}
              style={{ paddingLeft: 12 + depth * 16 }}
              onClick={() => pickCol(c.key)}
            >
              <span className="folder-icon">{selectedCol === c.key ? '📂' : '📁'}</span>{c.name}
            </button>
            <span className="folder-ops">
              <button className="folder-op" title="重命名" onClick={() => { setRenamingId(c.key); setRenameVal(c.name) }}>✎</button>
              <button
                className={'folder-op' + (confirmDelFolder === c.key ? ' danger' : '')}
                title={confirmDelFolder === c.key ? '再点一次确认删除（论文不会被删）' : '删除文件夹'}
                onClick={() => removeFolder(c.key)}>
                {confirmDelFolder === c.key ? '确认?' : '✕'}
              </button>
            </span>
          </div>
        )}
        {kids.length > 0 && <ul className="folder-children">{kids.map(k => renderFolder(k, depth + 1))}</ul>}
      </li>
    )
  }

  async function handleAdded(p: Paper) {
    setPapers(await window.api.listPapers(selectedCol))
    onSelect(p)
  }

  return (
    <div className="library">
      {/* 顶栏：当前文件夹（点击展开树）+ 添加论文 */}
      <div className="lib-topbar">
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
        <button className="lib-add-btn" title="添加论文（DOI / arXiv / PDF）" onClick={() => setShowAdd(true)}>＋</button>
      </div>
      {showAdd && <AddPaperModal onClose={() => setShowAdd(false)} onAdded={handleAdded} />}
      {editPaper && (
        <EditPaperModal
          paper={editPaper}
          folders={collections}
          onClose={() => setEditPaper(null)}
          onSaved={p => { refreshPapers(); if (p.key === selectedKey) onSelect(p) }}
          onDeleted={key => { refreshPapers(); onDeleted?.(key) }}
        />
      )}
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
          <li className="folder-new">
            {creatingFolder ? (
              <input
                className="folder-rename-input"
                autoFocus
                placeholder="新文件夹名…"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitNewFolder()
                  if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
                }}
                onBlur={submitNewFolder} />
            ) : (
              <button className="folder-row folder-new-btn" onClick={() => setCreatingFolder(true)}>
                ＋ 新建文件夹{selectedCol ? '（在当前文件夹下）' : ''}
              </button>
            )}
          </li>
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
              <button
                className="paper-edit-btn"
                title="编辑论文"
                onClick={e => { e.stopPropagation(); setEditPaper(p) }}>✎</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
