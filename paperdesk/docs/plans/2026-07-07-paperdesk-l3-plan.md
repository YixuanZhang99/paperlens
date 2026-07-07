# PaperDesk L3(管理:文件夹/元数据/级联删除)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 checkbox 跟踪。

**Goal:** 文献库可维护——文件夹新建/重命名/删除;论文编辑元数据、调整归属、删除(级联清笔记/高亮/对话/索引/PDF)。

**Architecture:** library-repo 补管理方法 → 6 个新 IPC → LibraryView:文件夹树内联操作(✎/✕/新建,Electron 无 window.prompt,一律 inline 输入) + 论文「✎ 编辑」弹窗(元数据+归属多选+删除合一)。

## Global Constraints

- 同 L1/L2。删文件夹:子文件夹上提一级(parent 置为被删者的 parent),论文只解除归属。
- 删论文:二次确认;级联删 notes/highlights/chat_messages/chunks(FTS 触发器自动清)/pdf_cache/lib_paper_folders/lib_papers + PDF 文件 + pagedTextCache;删的是当前选中论文时经 onDeleted 通知 App 清空阅读器。

---

### Task 1: library-repo 管理方法(TDD)

**Interfaces:**
```ts
updatePaper(key, m: { title; authors: string[]; year: number|null; abstract: string; doi?: string|null }): void
deletePaper(key): void                       // 只清 lib_papers + lib_paper_folders
getPaperFolders(paperKey): string[]          // 归属回显
addFolder(f: { name; parentId?: string|null }): ZoteroCollection   // id 生成 8 位
renameFolder(id, name): void
deleteFolder(id): void                       // 子文件夹上提一级 + 清归属行
```
- [ ] 测试:update 改字段不动 created_at/pdf_path;deletePaper 清两表;addFolder 返回形状;rename;deleteFolder 子上提+归属清;getPaperFolders。
- [ ] 实现 + 绿 + commit。

### Task 2: IPC + preload

- [ ] `folder:add`/`folder:rename`/`folder:delete`;`paper:update`/`paper:delete`(级联+删 PDF 文件+清缓存)/`paper:folders`/`paper:setFolders`。
- [ ] preload:addFolder/renameFolder/deleteFolder/updatePaper/deletePaper/getPaperFolders/setPaperFolders。
- [ ] tsc 0 + commit。

### Task 3: LibraryView 管理 UI + 组件测试

- [ ] 文件夹树:每行 hover 显示 ✎(行内改名输入,Enter 确认)与 ✕(两步确认);树底「＋ 新建文件夹」(行内输入,建到顶层;选中文件夹时建为其子级)。
- [ ] 论文条目 hover 显示 ✎ → EditPaperModal:标题/作者/年份/摘要/DOI 表单 + 归属 checkbox 列表 + 「删除论文」(两步,提示级联) + 保存。
- [ ] props 加 `onDeleted?: (key: string) => void`;App 里删除当前选中时 setSelected(null)。
- [ ] 组件测试:编辑保存调 updatePaper+setPaperFolders+刷新;删除两步→deletePaper+onDeleted;新建/重命名/删除文件夹。
- [ ] 全量绿 + commit。

### Task 4: 真机冒烟 + 打包

- [ ] 驱动(dev):新建文件夹→改名→给 L2 加的论文(F1C69050)设归属→编辑标题→验证 listFolders/listPapers 反映→删除该论文→列表 21→20、chunks/notes 无残留、PDF 文件消失。
- [ ] 全 vitest + tsc;打包安装;push;更新记忆。
