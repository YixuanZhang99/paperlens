# PaperLens AI 能力增强 — 设计文档

> 状态：已获用户批准（2026-06-10）。架构方案 C「按职责落位的小增量」。
> 下游：由 writing-plans 产出逐任务 TDD 实现计划。

## 需求（用户确认）

四项 AI 能力，全部入选：

1. **一键结构化精读**：一键生成结构化精读笔记（背景问题/核心贡献/方法/实验与结论/局限与展望），**直接存为本地笔记**（带 AI 标签），Notion 同步仍手动。
2. **快捷提问模板**：对话框上方预设问题 chips，点即问。
3. **AI 自动打标签**：存笔记时 AI 生成 2–4 个主题标签（填补 tags 恒为空、Notion Tags 列无意义的缺口）。
4. **深度思考模式**：对话可切 `deepseek-reasoner`，**思维链以灰色小字流式显示**在答案上方。

## 被否方案与理由

- **方案 A（纯前端模板复用聊天通道）**：精读污染对话历史（后续轮次重发全文精读浪费 token）；prompt 工程落在 renderer 违背「逻辑在主进程、可单测」架构。
- **方案 B（通用 AI 任务管道）**：当前仅 2 个后端任务，抽象提前，违背 YAGNI。

## 设计（方案 C）

### 服务层（`src/main/services/ai-chat.ts`，纯函数，可单测）
- `buildDeepReadMessages(paper, paperText): ChatMessage[]` — 精读 prompt，要求按五段结构输出 Markdown；复用 60k `maxContextChars` 截断。
- `buildTagMessages(content): ChatMessage[]` — 要求输出 2–4 个标签的 JSON 数组（中文或英文术语）。
- `parseTags(text): string[]` — 提取 JSON 数组（容忍 ```json 围栏），元素须为字符串、截至 4 个；**任何解析失败回退 `[]`**。
- `stream(messages, onToken)` 回调扩展为 `onToken(delta: string, kind: 'content' | 'reasoning')`：SSE 解析在 `choices[0].delta.content` 之外增读 `delta.reasoning_content`（kind='reasoning'）。**返回值仍只累计 content**。现有调用方 `(d) => …` 类型兼容；现有 4 个流式测试不受影响。

### IPC / 容器
- `container.ts`：`ai()` 工厂加可选参数 `ai(model?: string)`，默认仍取配置 `deepseekModel`。
- `chat:stream` 参数加 `deepThink?: boolean` → 主进程用 `c.ai('deepseek-reasoner')`；`chat:token` 事件追加第三参 `kind`。
- `notes:add` 参数加 `autoTag?: boolean`：为 true 且 tags 为空时，主进程 `generateTags(content)`（`complete(buildTagMessages)` + `parseTags`，**失败 catch 回 `[]`，绝不阻塞保存**）。
- 新 `paper:deepread`（args: paper）：
  1. 取全文——**从现有 `paper:text` handler 提炼共享 helper（含 sqlite 缓存逻辑）复用**，不复制；
  2. `buildDeepReadMessages` → `c.ai().stream(...)`，token 经独立 **`deepread:token`** 通道推送（不与聊天串台、不进聊天历史）；
  3. 完成后 `generateTags(全文精读)`；
  4. `notesRepo.add({ paperKey, content, tags })` → 返回 Note。
  精读用默认 chat 模型（不叠 reasoner，YAGNI）。
- `preload`：`streamChat` 透传 `deepThink` 与 `kind`；新增 `deepReadPaper(paper, onToken): Promise<Note>`（订阅 `deepread:token`，finally 移除监听）。

### UI
- **ChatView**：
  - `QUICK_PROMPTS` 常量 5 条：核心贡献 / 方法解读 / 实验与结论 / 局限与改进 / 大白话解释；chips 置于输入框上方，点击即发送，busy 禁用。
  - 「深思」开关（发送旁），传 `deepThink`。
  - 思维链渲染：本地气泡类型 `Bubble = ChatMessage & { reasoning?: string }`；reasoning 灰色小字显示在该气泡 content 上方；**传给 streamChat 的 history 剥离 reasoning**（共享 `ChatMessage` 类型不动）。存为笔记带 `autoTag: true`。
- **ReaderView**：摘要页加「✨ AI 精读」按钮；运行中灰色区流式预览 token；完成后刷新笔记列表；笔记条目渲染标签小 chips。

### 错误处理
- 精读失败 → ReaderView 现有 `role="alert"` 横幅模式。
- 打标签失败 → 静默回空标签（保存不受影响）。
- 深思模式错误 → 走聊天现有错误横幅。

### 测试策略
- 纯函数单测：`buildDeepReadMessages` / `buildTagMessages` / `parseTags`（含围栏/坏 JSON/超 4 个）。
- `stream()` reasoning 单测：SSE 含 `reasoning_content` delta → kind 正确分发、返回值仅 content。
- RTL：ChatView（chips 渲染+点击发送、深思开关传参、思维链灰色渲染）；ReaderView（精读按钮调用 api、完成刷新、标签渲染）。
- IPC/preload 胶水照旧：tsc + build + 真实冒烟（`npm run e2e:real` 可后续加精读腿）。

### 成本
精读 = 1 次流式（全文上下文）+ 1 次小 complete（标签）；存笔记自动标签 = 1 次小 complete。深思按需开。
