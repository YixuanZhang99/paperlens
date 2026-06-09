# PaperLens 手动冒烟清单

> 自动化测试（`npm test`，48 项）覆盖所有服务逻辑与 UI 交互（含 SSE 流式解析、PDF 标签）。其中：
> - **真实 HTTP + 真实 pdf.js 端到端**（`tests/e2e/api-integration.test.ts`）：本地服务器 + 真实 `fetch` 跑实际 Zotero/DeepSeek（complete+stream）/Notion 客户端，并用真实 pdf.js 抽取一份手工 PDF——验证真实网络/解析/流式路径。
> - **Electron 启动冒烟**（`npm run e2e:electron`，需 GUI 会话）：用真实构建的 preload+renderer 开窗，断言 `window.api` 注入、全部方法到位、IPC 往返成功——抓住 preload 路径类的运行时 bug。
> - **真实-API 冒烟**（`npm run e2e:real`，需真实凭证经环境变量传入；无凭证则自动跳过）：用真实 `fetch` 打 LIVE Zotero/DeepSeek/Notion，验证你自己的账号配置。Zotero/Notion 只读，DeepSeek 发 1 次小请求；不写入。
>   ```bash
>   ZOTERO_USER_ID=... ZOTERO_API_KEY=... DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-chat NOTION_TOKEN=... npm run e2e:real
>   ```
>   注意：① DeepSeek 模型须用 `deepseek-chat`/`deepseek-reasoner`（`v4-flash` 等非法名会 400）；② Zotero PDF 下载需库内文件已**同步到 Zotero 云存储**（Settings→Sync→Sync attachment files），否则 `/file` 返回 404；③ Notion 需把集成连接到目标数据库才能被发现。
>
> `npm run build` 验证可打包，`npm run dist` 已实测产出 macOS dmg。以下为需要**真实凭证**、必须人工执行的端到端验证（自动化测试无法覆盖真实第三方 API 与可视 GUI）。

## 前置：准备凭证
启动后点击左上角「⚙ 设置」，填入：
- **Zotero**：User ID（在 https://www.zotero.org/settings/keys 查看「Your userID」）+ API Key（新建 key，勾选 *Allow library access* / read）。
- **DeepSeek**：API Key（https://platform.deepseek.com）。Model 默认 `deepseek-chat`。
- **Notion**：Internal Integration Token（https://www.notion.so/my-integrations）+ 目标数据库 ID。数据库需含列：`Title`(title)、`Authors`(rich text)、`Year`(number)、`Tags`(multi-select)，并把该 integration *Connect* 到这个数据库。
点「保存」（凭证经 Electron safeStorage 加密存于 userData/config.enc；若系统无 keychain 则明文存储）。

## 启动
```bash
cd paperlens
npm install      # 首次
npm run dev      # 开发模式启动
```

## 步骤
1. [ ] 左栏出现 Zotero 论文列表（失败时显示「加载失败，请检查 Zotero 配置」→ 核对 User ID / API Key）。
2. [ ] 点击一篇论文，中栏「摘要」标签显示标题 / 作者 / 年份 / 摘要 / 学习笔记。
3. [ ] 切到中栏「全文 PDF」标签 → 下载并逐页渲染该论文 PDF（无 PDF 附件时提示）。
4. [ ] 右栏输入问题 → DeepSeek 回答以**流式逐字**显示。首次会拉取并缓存该论文 PDF 全文（稍慢）；纯扫描版 PDF 无文本时 AI 仅依据元数据作答。
5. [ ] 点「存为笔记」→ 切到「摘要」标签，「学习笔记」出现该笔记。
6. [ ] 点笔记的「同步到 Notion」→ Notion 数据库新增一行：Title=论文名、Authors、Year、Tags，正文段落=笔记内容；按钮变为「✓ 已同步 Notion」。
7. [ ] 再次对同一篇论文的同一笔记同步 → 为更新（PATCH）而非重复新建（注：当前每次「存为笔记」会新建一条本地笔记，已同步的笔记再点同步走 PATCH，仅更新 properties）。

## 打包成安装包
```bash
npm run dist     # electron-vite build + electron-builder → release/
```
产物在 `release/`：macOS `PaperLens-<ver>-arm64.dmg`、Windows nsis、Linux AppImage（按当前平台）。mac 为未签名本地构建（`identity: null`）。

> ⚠️ **原生模块 ABI 注意**：`npm run dist` 会把 `better-sqlite3` 原生模块重建为 **Electron 的 ABI**，与 `npm test` 所用的系统 Node ABI 不同。因此**跑过 `dist` 之后若要再跑 `npm test`，先执行 `npm rebuild better-sqlite3`** 还原系统 Node 的二进制，否则 db/notes 相关测试会报 `NODE_MODULE_VERSION` 不匹配。（全新 clone 后 `npm install` 默认即为系统 Node ABI，不受影响。）

## 排错
- 任一外部调用失败会作为 IPC rejection 冒泡（控制台可见报错）。主进程错误看终端；渲染层错误看 DevTools（开发模式下可手动打开，菜单或快捷键）。
- Notion 400「invalid db」→ 数据库 ID 错误或 integration 未连接到该库。
- DeepSeek 401 → API Key 错误。
