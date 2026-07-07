# PaperDesk L2(入库:DOI/arXiv/拖 PDF)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 checkbox 跟踪。

**Goal:** 「+ 添加论文」——粘贴 DOI/arXiv 号自动拉元数据(arXiv 并自动下 PDF);拖 PDF 猜标题入库;拉取失败可纯手动填。

**Architecture:** 纯函数 `metadata-fetch.ts`(识别输入 + Crossref/arXiv 解析,注入 fetch 可单测)→ 4 个新 IPC(addByRef/sniffPdf/addManual/attachPdf)→ LibraryView 顶部按钮 + 添加弹窗。

## Global Constraints

- 同 L1(不动 paperlens/;ABI 舞步;打包验证惯例)。
- 新论文 key:8 位大写字母数字(randomUUID 截取),与 lib_papers 查重后使用。
- arXiv API `https://export.arxiv.org/api/query?id_list=<id>`(Atom XML,正则抽字段);Crossref `https://api.crossref.org/works/<doi>`(JSON,abstract 剥 JATS 标签)。网络失败 → 明确报错,UI 提供手动填写。

---

### Task 1: metadata-fetch(TDD)

**Files:** Create `src/main/services/metadata-fetch.ts`;Test `tests/main/metadata-fetch.test.ts`

**Interfaces:**
```ts
parseRefInput(input: string): { kind: 'arxiv'; id: string } | { kind: 'doi'; doi: string } | { kind: 'unknown' }
// 支持:2405.12345(v2)、arxiv.org/abs|pdf 链接、10.x/…、doi.org 链接、doi: 前缀
export interface FetchedMeta { title: string; authors: string[]; year: number | null; abstract: string; doi?: string | null; arxivId?: string | null; pdfUrl?: string | null }
fetchArxivMeta(id: string, fetchFn: typeof fetch): Promise<FetchedMeta>   // pdfUrl=https://arxiv.org/pdf/<id>
fetchCrossrefMeta(doi: string, fetchFn: typeof fetch): Promise<FetchedMeta> // pdfUrl=null
```
- [ ] 测试:识别 6 种输入格式 + unknown;arXiv Atom 样例解析(title 折行合并/多作者/year/summary/pdfUrl);Crossref 样例(JATS abstract 剥标签、无 author/year 容错、title 数组取首);404/非 200 抛错。
- [ ] 实现 + 测试绿 + commit。

### Task 2: IPC + preload

**Files:** Modify `src/main/ipc.ts`、`src/preload/index.ts`

**Interfaces(preload):**
```ts
addPaperByRef(input: string): Promise<{ paper: Paper; pdf: boolean }>   // arXiv 自动下 PDF
sniffPdf(bytes: ArrayBuffer): Promise<{ titleGuess: string }>           // 首页文本首行(≤120 字符)
addPaperManual(m: { title; authors: string[]; year: number|null; abstract: string; doi?: string|null }): Promise<Paper>
attachPaperPdf(paperKey: string, bytes: ArrayBuffer): Promise<void>     // 写 library/<key>.pdf
```
- [ ] `paper:addByRef`:parse→fetch(arXiv/Crossref)→genKey(查重)→upsertPaper→arXiv pdfUrl 下载写盘 setPaperPdf(失败仅标记 pdf:false)。
- [ ] `paper:sniffPdf`:extractPdfText(bytes, {maxChars: 600}) 取第一行非空 trim 前 120 字。
- [ ] `paper:addManual` / `paper:attachPdf`(attach 后清 pdf_cache/pagedTextCache 该 key)。
- [ ] tsc 0 + commit。

### Task 3: LibraryView 添加弹窗 + 组件测试

**Files:** Modify `src/renderer/components/LibraryView.tsx`、`src/renderer/styles.css`;Test `tests/renderer/LibraryView.test.tsx`

- [ ] 顶栏「＋ 添加论文」按钮(folder-current 右侧)→ 弹窗(.modal-backdrop 复用):
  - 贴号区:input + 「获取」→ 预览(title/authors/year + PDF 状态)→「加入文献库」(实际 addPaperByRef 在「获取」时已入库?**不**——两段式:获取仅预览会让实现复杂;简化:「获取并加入」一步完成,成功显示结果行 + 关闭按钮;失败显示错误 + 展开手动表单)
  - 拖 PDF 区:dropzone(drop/选择文件)→ sniffPdf 显示可编辑标题 → 「加入」= addPaperManual + attachPaperPdf
  - 手动表单:title(必填)/authors(逗号分隔)/year/abstract → addPaperManual
- [ ] 成功后:刷新 listPapers、onSelect 新论文、关弹窗。
- [ ] 组件测试:贴号成功流(mock addPaperByRef;断言调用+刷新);贴号失败→手动表单出现;拖 PDF 流(mock sniffPdf/addPaperManual/attachPaperPdf)。
- [ ] 全量测试绿 + commit。

### Task 4: 真机验证 + 打包

- [ ] 驱动:贴真实 arXiv 号(如 1706.03762 Attention Is All You Need)→ 断言列表 +1、PDF 可读(getPaperPdf 字节>10000)、标题正确;截图。
- [ ] 全 vitest + tsc;打包安装并存;push;更新记忆。
