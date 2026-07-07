# PaperDesk 设计——一体化文献阅读软件(新 APP,自建文献库,不依赖 Zotero/Notion)

> 状态:已获用户批准(2026-07-07)。下一步:writing-plans 制定实现计划。

## 背景与目标

PaperLens 目前把 Zotero 当文献库事实来源(元数据/文件夹/PDF),把 Notion 当笔记导出口。用户希望一体化(日常只用一个软件),且**不破坏现有 PaperLens**。

结论:**新开一个 APP「PaperDesk」**,以 PaperLens 代码副本为起点做文献库独立;PaperLens 冻结现状、随时可用。

澄清结论(决定方案的四个事实):
1. 用户加论文的方式是**按 DOI/arXiv 号添加**——公开 API 可接管,不依赖 Zotero 浏览器抓取器;
2. **不需要引用管理**(BibTeX/Word 插件);
3. Notion 笔记**无独立用途**——笔记本地化即可,Notion 同步保留现状但不再是核心路径;
4. 旧 PaperLens 积累的笔记/高亮/对话/知识库索引**全部搬进 PaperDesk**。

(未选「在 PaperLens 原地改造」:用户要求不破坏已验证的现有功能;未选「从零写新 APP」:PDF 阅读/高亮、AI 对话/精读/综述、知识库混合检索都已验证,复制即得。)

## L0:应用分叉策略

- 仓库组织:work 仓库下新建 `paperdesk/` 目录(与 `paperlens/` 平级),复制全部源代码/脚本/配置为起点。
- 身份变更:`package.json` name=`paperdesk`、productName=`PaperDesk`、appId=`com.paperdesk.app` → Electron userData 自动隔离为 `~/Library/Application Support/paperdesk/`,与 PaperLens 互不干扰,两 APP 可并存安装。
- 图标:复用 make-icon.mjs 换配色(区分于 PaperLens 的蓝色)。
- e2e 驱动/打包脚本内的应用名/userData 路径随改;分叉后先把全测试套件在 paperdesk/ 下跑绿作为基线,再开发新功能。
- PaperLens:冻结,不再加功能(仅致命 bug 修复)。
- ⚠️ **safeStorage 加密与应用绑定**(macOS Keychain 条目按产品名):PaperLens 的 config.enc 在 PaperDesk 无法解密 → **API key(DeepSeek/Kimi/Notion)需在 PaperDesk 设置里重填一次**(一次性成本,迁移向导中明确提示)。

## 数据模型

PaperDesk 的 SQLite 新增三张表(沿用幂等迁移机制):

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

**关键决策:paperKey 原样保留。** 迁移沿用 Zotero item key 作为 `lib_papers.key`,搬来的 notes/highlights/chat_messages/chunks(1789 个向量块)的 `paper_key` 关联全部无缝衔接。新添加论文用生成 key(8 位大写字母数字,与 Zotero key 风格一致)。

**PDF 自管**:存 `userData/library/<key>.pdf`,`pdf_path` 记文件名。

## 迁移(双源,一次性,均幂等)

首启引导页按检测结果给入口:

1. **从旧 PaperLens 搬数据**(检测到 `~/Library/Application Support/paperlens/paperlens.db` 时提供):整库拷贝为 PaperDesk 的库基础(notes/highlights/chat_messages/chunks/pdf_cache 全量保留),随后跑迁移追加 lib_* 表。**知识库向量索引直接带走,无需重建;模型缓存(models/)一并拷贝,免重复下载。**
2. **从 Zotero 导入文献**:元数据 + collections 树(→ lib_folders,含多归属)+ PDF **拷贝**入 `library/`(绝不动 Zotero 原库);本地 storage 缺失走 Web API 下载;都失败标「无 PDF」可后补。key 沿用 → 与第 1 步搬来的数据自动对齐。
3. 没有旧数据/Zotero 时:「添加第一篇论文」空库起步。

幂等:两步均按 key upsert(整库拷贝仅在目标库为空时执行),中断可重跑;迁移进度经 IPC 推送(复用 kb:progress 模式)。

## 数据源切换

现有 IPC 通道名与语义不变(`zotero:list`、`zotero:collections`、`paper:pdf` 等),主进程实现改为读 `library-repo`/本地 PDF 文件 → 渲染层文献列表/文件夹树/筛选零改动,风险集中在主进程一层。`zotero-client`/`zotero-local` 保留仅供导入。高亮「同步 Zotero」按钮退役(隐藏);Notion 同步照旧保留。

## 入库流程

「+ 添加论文」(左栏顶部)弹窗,两种方式:

1. **粘贴 DOI/arXiv 号**(主流程):自动识别输入格式(`10.x/...`、`2405.12345`、arXiv/DOI 链接均可)。
   - arXiv → arXiv API(`export.arxiv.org/api/query`)拉标题/作者/年份/摘要 + **自动下载 PDF**;
   - DOI → Crossref API(`api.crossref.org/works/<doi>`)拉元数据;期刊 PDF 一般有墙,先建条目,PDF 后拖补。
2. **拖 PDF**:读 PDF 内嵌元数据/首页文本猜标题 → 确认框(可改)→ 入库。

新服务 `metadata-fetch.ts`(纯函数 + 注入 fetch,可单测):识别输入 → 拉取 → 规整为 `{title, authors[], year, abstract, doi?, arxivId?, pdfUrl?}`。

## 管理操作

- 文件夹:新建/重命名/删除(删文件夹只解除归属不删论文,论文仍在「全部论文」中)。
- 论文:编辑元数据(标题/作者/年份/摘要/DOI)、移动到文件夹(多选归属)、删除。
- 删除论文:二次确认,提示「将同时删除其笔记/高亮/对话与索引」,级联删 notes/highlights/chunks/chat_messages 与 PDF 文件。

## 引导与设置

- 空库时 LibraryView 显示引导页(见「迁移」的三个入口)。
- 设置:Zotero 区块改「从 Zotero 导入(一次性)」;新增「文献库」区块(数据目录路径 +「打开数据目录」按钮);Notion 区块不动。

## 错误处理

- DOI/arXiv 拉取失败(网络/404):明确报错,允许**纯手动填元数据**建条目。
- arXiv PDF 下载失败:条目保留,标「无 PDF」,可后补。
- 迁移中断:幂等重跑。
- 打开无 PDF 论文:阅读器显示占位提示(拖 PDF 补)。

## 数据安全取舍

库在 `userData`(macOS Time Machine 覆盖);设置提供「打开数据目录」便于手动备份。本期不做 zip 导出/云同步(单机场景,YAGNI)。

## 测试策略

- L0 基线:分叉后全测试套件(234)在 paperdesk/ 下先跑绿。
- 单测:library-repo CRUD(内存 sqlite)、metadata-fetch 解析(mock Crossref/arXiv 响应)、双源迁移(key 保留/文件夹映射/幂等/整库拷贝守卫)、输入格式识别。
- 组件测试:LibraryView 添加/编辑/删除/引导页流程。
- 端到端:真机驱动贴真实 arXiv 号走全流程(拉元数据→下 PDF→阅读→AI 对话);真库迁移验证(20 篇 + 笔记/高亮/1789 向量块无缝);打包安装验证(与 PaperLens 并存、数据目录隔离)。

## 不做(YAGNI)

浏览器一键抓取、BibTeX/引用导出、多设备同步、笔记编辑器升级、重复文献检测、Notion 替代、PaperLens 与 PaperDesk 双向同步(单向迁移一次)。

## 交付批次

0. **L0 分叉建 APP**:复制代码、改身份/图标/脚本、测试基线跑绿、打包出可并存安装的 PaperDesk(功能=现 PaperLens)。
1. **L1 数据层+双源迁移**(最大):三张表、library-repo、旧 PaperLens 整库搬迁、zotero-import、IPC 换源、真库迁移验证。
2. **L2 入库**:metadata-fetch、DOI/arXiv 添加、拖 PDF、手动元数据。
3. **L3 管理**:文件夹/论文操作、级联删除、空库引导。
4. **L4 收尾**:设置调整、退役高亮同步按钮、全回归、打包真机验收(两 APP 并存)。
