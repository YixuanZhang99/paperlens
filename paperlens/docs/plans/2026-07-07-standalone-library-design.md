# PaperLens 文献库独立(去 Zotero/Notion 依赖)设计

> 状态:已获用户批准(2026-07-07)。下一步:writing-plans 制定实现计划。

## 背景与目标

PaperLens 目前把 Zotero 当文献库事实来源(元数据/文件夹/PDF),把 Notion 当笔记导出口。用户希望一体化:日常只用 PaperLens 一个软件。

澄清结论(决定方案的三个事实):
1. 用户加论文的方式是**按 DOI/arXiv 号添加**——公开 API 可接管,不依赖 Zotero 浏览器抓取器;
2. **不需要引用管理**(BibTeX/Word 插件)——Zotero 第二护城河对用户无用;
3. Notion 笔记**无独立用途**(不在手机看/不分享)——笔记本地化即可,Notion 同步保留现状但不再是核心路径。

因此选择**方案 A:彻底独立**。PaperLens 自建文献库,Zotero 降级为一次性导入源。
(未选 B「Zotero 退到后台」:仍需装 Zotero、开写权限 key,一体化不彻底;未选 C「双模并存」:同步语义复杂,不值。)

## 数据模型

现有 SQLite(`paperlens.db`)新增三张表,沿用幂等迁移机制(CREATE IF NOT EXISTS + PRAGMA 守卫):

```sql
CREATE TABLE IF NOT EXISTS lib_papers (
  key        TEXT PRIMARY KEY,   -- 迁移沿用 Zotero item key;新增用生成 key
  title      TEXT NOT NULL,
  authors    TEXT NOT NULL DEFAULT '[]',  -- JSON string array
  year       INTEGER,
  abstract   TEXT NOT NULL DEFAULT '',
  doi        TEXT,
  arxiv_id   TEXT,
  pdf_path   TEXT,               -- 相对 userData/library/ 的文件名;NULL=无 PDF
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lib_folders (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  parent_id TEXT,                -- 树形;NULL=顶层
  sort      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lib_paper_folders (  -- 多对多,保真 Zotero 多归属
  paper_key TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  PRIMARY KEY (paper_key, folder_id)
);
```

**关键决策:paperKey 原样保留。** 迁移直接沿用 Zotero item key 作为 `lib_papers.key`,已有的 notes/highlights/chat_messages/chunks(1789 个向量块)的 `paper_key` 关联全部无缝衔接,零改动。新添加论文用生成 key(randomUUID 截短,8 位大写字母数字,与 Zotero key 风格一致、不冲突即可)。

**PDF 自管**:存 `userData/library/<key>.pdf`,`pdf_path` 记文件名。

## 迁移(一次性,幂等)

- 入口:空库引导页「从 Zotero 导入」按钮(设置里也保留入口可重跑)。
- 元数据:优先 Web API(现有 zotero-client listPapers/listCollections),本地 zotero-local 兜底定位 PDF。
- PDF:从本地 Zotero storage **拷贝**(绝不动原文件,Zotero 原库零风险);本地缺失走 Web API 下载;都失败标记无 PDF,条目保留可后补。
- collections 树 → lib_folders(含层级),多归属 → lib_paper_folders。
- 幂等:按 key upsert,中断可重跑,不产生重复。
- 迁移进度经 IPC 推送到引导页(复用 kb:progress 模式)。

## 数据源切换

现有 IPC 通道名与语义不变(`zotero:list`、`zotero:collections`、`paper:pdf` 等),主进程实现改为读 `library-repo`/本地 PDF 文件。渲染层文献列表/文件夹树/筛选零改动,风险集中在主进程一层。`zotero-client`/`zotero-local` 保留,仅供导入。高亮"同步 Zotero"按钮退役(隐藏);Notion 同步照旧。

## 入库流程

「+ 添加论文」(左栏顶部)弹窗,两种方式:

1. **粘贴 DOI/arXiv 号**(主流程):自动识别输入格式(`10.x/...`、`2405.12345`、arXiv/DOI 链接均可)。
   - arXiv → arXiv API(`export.arxiv.org/api/query`)拉 标题/作者/年份/摘要 + **自动下载 PDF**;
   - DOI → Crossref API(`api.crossref.org/works/<doi>`)拉元数据;期刊 PDF 一般有墙,先建条目,PDF 后拖补。
2. **拖 PDF**:读 PDF 内嵌元数据/首页文本猜标题 → 确认框(可改)→ 入库。

新服务 `metadata-fetch.ts`(纯函数 + 注入 fetch,可单测):识别输入 → 拉取 → 规整为 `{title, authors[], year, abstract, doi?, arxivId?, pdfUrl?}`。

## 管理操作

- 文件夹:新建/重命名/删除(删文件夹只解除归属不删论文,论文仍在「全部论文」中)。
- 论文:编辑元数据(标题/作者/年份/摘要/DOI)、移动到文件夹(多选归属)、删除。
- 删除论文:二次确认,提示「将同时删除其笔记/高亮/对话与索引」,级联删 notes/highlights/chunks/chat_messages 与 PDF 文件。

## 空库引导与设置

- 空库(lib_papers 为 0)时 LibraryView 显示引导页:「从 Zotero 导入」/「添加第一篇论文」两个大按钮。
- 设置:Zotero 区块改「从 Zotero 导入(一次性)」;新增「文献库」区块(数据目录路径 + 「打开数据目录」按钮);Notion 区块不动。

## 错误处理

- DOI/arXiv 拉取失败(网络/404):明确报错,允许**纯手动填元数据**建条目。
- arXiv PDF 下载失败:条目保留,标「无 PDF」,可后补。
- 迁移中断:幂等重跑。
- 打开无 PDF 论文:阅读器显示占位提示(拖 PDF 补)。

## 数据安全取舍

库在 `userData`(macOS Time Machine 覆盖);设置提供「打开数据目录」便于手动备份。本期不做 zip 导出/云同步(单机场景,YAGNI)。

## 测试策略

- 单测:library-repo CRUD(内存 sqlite)、metadata-fetch 解析(mock Crossref/arXiv 响应)、zotero-import(key 保留/文件夹映射/幂等)、输入格式识别。
- 组件测试:LibraryView 添加/编辑/删除/引导页流程。
- 端到端:真机驱动贴真实 arXiv 号走全流程(拉元数据→下 PDF→阅读→AI 对话);迁移真库验证(20 篇 + 关联数据无缝);打包安装验证。

## 不做(YAGNI)

浏览器一键抓取、BibTeX/引用导出、多设备同步、笔记编辑器升级、重复文献检测、Notion 替代。

## 交付批次

1. **L1 数据层+迁移+换源**(最大):三张表、library-repo、zotero-import、IPC 换源、真库迁移验证。
2. **L2 入库**:metadata-fetch、DOI/arXiv 添加、拖 PDF、手动元数据。
3. **L3 管理**:文件夹/论文操作、级联删除、空库引导。
4. **L4 收尾**:设置调整、退役高亮同步按钮、全回归、打包真机验收。
