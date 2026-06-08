# PaperLens 手动冒烟清单

> 自动化测试（`npm test`，35 项）覆盖所有服务逻辑与 UI 交互；生产构建（`npm run build`）已验证可打包。以下为需要真实凭证、必须人工执行的端到端验证。

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
2. [ ] 点击一篇论文，中栏显示标题 / 作者 / 年份 / 摘要。
3. [ ] 右栏输入问题 → 收到 DeepSeek 回答。首次会拉取并缓存该论文 PDF 全文（稍慢）；纯扫描版 PDF 无文本时 AI 仅依据元数据作答。
4. [ ] 点「存为笔记」→ 中栏「学习笔记」出现该笔记。
5. [ ] 点笔记的「同步到 Notion」→ Notion 数据库新增一行：Title=论文名、Authors、Year、Tags，正文段落=笔记内容；按钮变为「✓ 已同步 Notion」。
6. [ ] 再次对同一篇论文的同一笔记同步 → 为更新（PATCH）而非重复新建（注：当前每次「存为笔记」会新建一条本地笔记，已同步的笔记再点同步走 PATCH，仅更新 properties）。

## 排错
- 任一外部调用失败会作为 IPC rejection 冒泡（控制台可见报错）。主进程错误看终端；渲染层错误看 DevTools（开发模式下可手动打开，菜单或快捷键）。
- Notion 400「invalid db」→ 数据库 ID 错误或 integration 未连接到该库。
- DeepSeek 401 → API Key 错误。
