# PaperLens 🔍

AI 驱动的论文阅读工作台：用 **Zotero** 管理文献，在应用内高清阅读 PDF，与 **DeepSeek** 对话精读，学习笔记一键同步 **Notion**，并把整个文献库变成可对话的**知识库**。

## 功能

- **📚 Zotero 文献库** — 文件夹（collections）树形浏览，与 Zotero 实时同步；PDF 优先从本地 Zotero storage 读取
- **📄 高清 PDF 阅读** — Retina 锐利渲染，50%–300% 缩放，三栏可拖拽调宽/收起
- **🤖 AI 对话与精读** — DeepSeek 流式对话（支持深思/思维链）、快捷提问、一键结构化精读成笔记 + 自动标签，Markdown 渲染
- **🧠 知识库** — 全库自动索引（SQLite FTS5，纯本地零费用）；对整个文献库提问，AI 检索原文片段作答并标注可点击的来源论文；跨论文笔记聚合浏览
- **📝 Notion 同步** — 笔记一键同步到 Notion 数据库（标题/作者/年份/标签/正文）

## 技术栈

Electron + electron-vite · React 18 + TypeScript (strict) · better-sqlite3（FTS5 trigram 全文检索）· pdfjs-dist · Zotero Web API v3 · DeepSeek API（OpenAI 兼容，SSE 流式）· Notion API · Vitest + React Testing Library（97 项测试，TDD）

## 快速开始

```bash
cd paperlens
npm install
npm run dev
```

启动后点「⚙ 设置」填入 Zotero User ID + API Key、DeepSeek API Key、Notion Token + Database ID（凭证经 Electron safeStorage 加密存储，不入库不入 git）。详见 [冒烟清单](paperlens/docs/SMOKE.md)。

```bash
npm test             # 单元/集成测试（需系统 Node ABI：npm rebuild better-sqlite3）
npm run e2e:drive    # 交互式端到端验收（真实应用+真实凭证，DRIVE_QUICK=1 跳过付费步骤）
npm run dist         # 打包安装包（dmg / nsis / AppImage）
```

> ⚠️ better-sqlite3 原生模块在「跑测试（系统 Node）」与「跑应用（Electron）」间需要重建，见 SMOKE.md 的 ABI 说明。

## 设计文档

[docs/plans/](docs/plans/) 保存了每个特性的设计与逐任务实现计划（brainstorming → design → TDD plan → subagent 执行）。
