# PaperDesk L0(分叉建 APP)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 PaperLens 代码分叉出独立 APP「PaperDesk」——新身份/新数据目录/新图标,测试基线跑绿,打包后与 PaperLens 并存安装;不动 PaperLens 任何文件。

**Architecture:** work 仓库(git 根)下复制 `paperlens/` → `paperdesk/` 平级目录;仅改身份字段与硬编码应用名;Electron 按 package name 自动隔离 userData 到 `~/Library/Application Support/paperdesk/`。

**Tech Stack:** 与 PaperLens 相同(Electron 32 + electron-vite + React + TS + better-sqlite3 + transformers.js)。

## Global Constraints

- **不修改 `paperlens/` 目录下任何文件**(设计:PaperLens 冻结)。
- 数据库文件名保持 `paperlens.db` 不改(内部实现细节;L1 整库拷贝同名对拷最简,避免无谓变更)。
- ABI 舞步:跑 vitest 前 `npm rebuild better-sqlite3`;跑 electron/打包前 `npx @electron/rebuild -f -w better-sqlite3`。
- 打包后必须:验证二进制无 NODE_MODULE_VERSION 错误、窗口真实出现、清 release/mac-arm64 副本 + lsregister 重建。
- 分支:`paperdesk`(已建),每个 Task 一次 commit。

---

### Task 1: 复制目录 + 改 package.json 身份

**Files:**
- Create: `paperdesk/`(整目录,复制自 `paperlens/`,排除生成物)
- Modify: `paperdesk/package.json`

**Interfaces:**
- Produces: `paperdesk/` 可独立 npm install 的工程;身份字段 name=`paperdesk` / productName=`PaperDesk` / appId=`com.paperdesk.app`(Task 3-5 及 L1+ 全部依赖)。

- [ ] **Step 1: rsync 复制(排除生成物)**

```bash
cd /Users/zhangyixuan06/work
rsync -a --exclude node_modules --exclude out --exclude release \
  --exclude e2e-shots --exclude .DS_Store paperlens/ paperdesk/
ls paperdesk/src/main/index.ts paperdesk/package.json && echo COPIED
```
Expected: `COPIED`

- [ ] **Step 2: 改身份字段**

```bash
cd /Users/zhangyixuan06/work/paperdesk
python3 - <<'EOF'
import json
p = json.load(open('package.json'))
p['name'] = 'paperdesk'
p['description'] = '一体化论文阅读与学习助手（自建文献库）'
p['build']['appId'] = 'com.paperdesk.app'
p['build']['productName'] = 'PaperDesk'
json.dump(p, open('package.json','w'), ensure_ascii=False, indent=2)
EOF
python3 -c "import json;d=json.load(open('package.json'));print(d['name'],d['build']['appId'],d['build']['productName'])"
```
Expected: `paperdesk com.paperdesk.app PaperDesk`

- [ ] **Step 3: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperdesk && git commit -m "feat(paperdesk): L0 分叉——复制 PaperLens 代码为起点,改应用身份"
```

### Task 2: 源码/脚本硬编码改名

**Files:**
- Modify: `paperdesk/src/renderer/index.html:3`(title)
- Modify: `paperdesk/src/main/services/embedder.ts:42`(serviceName)
- Modify: `paperdesk/src/main/services/notion-sync.ts:41`(截断提示文案)
- Modify: `paperdesk/scripts/e2e-drive.mjs:27-28`(setName/userData)
- Modify: `paperdesk/scripts/make-icon.mjs:4,87`(输出路径)
- Modify: `paperdesk/src/renderer/styles.css:1`、`paperdesk/src/main/services/zotero-annotation.ts:7`(注释)
- Modify: 顶栏 logo 文案(位置待 grep 确认,见 Step 1)

**Interfaces:**
- Consumes: Task 1 的 `paperdesk/` 目录。
- Produces: 运行时一切用户可见/系统可见标识均为 PaperDesk;e2e 驱动指向 paperdesk userData。

- [ ] **Step 1: 找到顶栏 logo 的拆开写法**

```bash
cd /Users/zhangyixuan06/work/paperdesk
grep -rn "Paper" src/renderer/App.tsx src/renderer/components/ | grep -v "论文\|paper-" | head
```
Expected: 命中类似 `Paper<b>Lens</b>` 或 `PaperLens` 的 logo 行(记下确切文件:行号,Step 2 一并改)。

- [ ] **Step 2: 批量替换(精确逐处,不用盲目 sed 全局)**

逐文件修改:
- `src/renderer/index.html`: `<title>PaperLens</title>` → `<title>PaperDesk</title>`
- `src/main/services/embedder.ts`: `serviceName: 'paperlens-embedder'` → `'paperdesk-embedder'`
- `src/main/services/notion-sync.ts`: `完整内容见 PaperLens 应用内笔记` → `完整内容见 PaperDesk 应用内笔记`
- `scripts/e2e-drive.mjs`: `app.setName('paperlens')` → `app.setName('paperdesk')`;`join(app.getPath('appData'), 'paperlens')` → `'paperdesk'`
- `scripts/make-icon.mjs`: 两处 `/work/paperlens/build` → `/work/paperdesk/build`
- `src/renderer/styles.css` 首行注释、`src/main/services/zotero-annotation.ts` 注释:PaperLens → PaperDesk
- Step 1 找到的 logo 行:`Lens` → `Desk`(保持原 JSX 结构)

- [ ] **Step 3: 复核无残留(白名单外)**

```bash
cd /Users/zhangyixuan06/work/paperdesk
grep -rni "paperlens" src/ scripts/ index.html 2>/dev/null | grep -v "paperlens.db"
```
Expected: 空输出(仅 `container.ts` 的 `paperlens.db` 保留——Global Constraints 规定)。

- [ ] **Step 4: Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperdesk && git commit -m "feat(paperdesk): 全部硬编码标识改为 PaperDesk(保留 paperlens.db 文件名)"
```

### Task 3: 依赖安装 + 测试基线跑绿

**Files:**
- Create: `paperdesk/node_modules/`(不入库)、可能更新 `paperdesk/package-lock.json`

**Interfaces:**
- Consumes: Task 1-2 的工程。
- Produces: 可构建可测的工程;基线=vitest 234 通过(232 passed + 2 skipped 的当前全量)、tsc 0。

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/zhangyixuan06/work/paperdesk && npm install 2>&1 | tail -2
```
Expected: 无 error(warn 可忽略)。

- [ ] **Step 2: Node ABI + 全测试**

```bash
cd /Users/zhangyixuan06/work/paperdesk
npm rebuild better-sqlite3 2>&1 | tail -1
npx vitest run 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files 32 passed | 2 skipped` / `Tests 232 passed | 2 skipped`(与 PaperLens 基线一致)。

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit; echo "tsc=$?"
```
Expected: `tsc=0`

- [ ] **Step 4: Commit(如 lock 有变)**

```bash
cd /Users/zhangyixuan06/work
git add paperdesk/package-lock.json 2>/dev/null; git diff --cached --quiet || git commit -m "chore(paperdesk): npm install 基线"
```

### Task 4: 图标换青绿配色

**Files:**
- Modify: `paperdesk/scripts/make-icon.mjs`(颜色值)
- Create: `paperdesk/build/icon-1024.png`、`paperdesk/build/icon.icns`(覆盖复制来的蓝色版)

**Interfaces:**
- Consumes: Task 3 的可运行工程(生成脚本需 electron)。
- Produces: PaperDesk 专属青绿图标,打包(Task 5)使用 `build/icon.icns`。

- [ ] **Step 1: 换色(蓝 → 青绿 teal,保持玻璃拟物结构)**

`scripts/make-icon.mjs` 中逐处替换颜色值:

```
#1652E6 → #0F766E   (主渐变深)
#2C7BF2 → #14B8A6   (主渐变中)
#1EB5EC → #2DD4BF   (主渐变亮)
#CDEBFF → #CCFBF1   (高光淡青)
#CFE7FF → #D5F7F1   (纸面渐变)
#BFDCFF → #BFF3EA   (纸面渐变深)
#0B2A6B → #134E4A   (投影)
#0A3FB0 → #0F5F58   (底部深色氛围)
```

- [ ] **Step 2: 切 Electron ABI 并生成**

```bash
cd /Users/zhangyixuan06/work/paperdesk
npx @electron/rebuild -f -w better-sqlite3 2>&1 | tail -1
./node_modules/.bin/electron scripts/make-icon.mjs
ls -la build/icon.icns build/icon-1024.png
```
Expected: 两文件存在且 mtime 为刚刚(覆盖成功)。

- [ ] **Step 3: 肉眼确认颜色(Read icon-1024.png 看是青绿非蓝)后 Commit**

```bash
cd /Users/zhangyixuan06/work
git add paperdesk && git commit -m "feat(paperdesk): 图标换青绿配色,与 PaperLens 区分"
```

### Task 5: 打包、并存安装、真机验证

**Files:**
- Create: `paperdesk/release/PaperDesk-0.1.0-arm64.dmg`(不入库)、`/Applications/PaperDesk.app`

**Interfaces:**
- Consumes: Task 1-4 全部产物。
- Produces: 可日常使用的 PaperDesk.app(功能=现 PaperLens,空库),与 PaperLens.app 并存;L1 在此基础上开发。

- [ ] **Step 1: 构建+打包**

```bash
cd /Users/zhangyixuan06/work/paperdesk
npm run build 2>&1 | grep "built in" | tail -1
npm run dist 2>&1 | grep -E "building.*DMG" | tail -1
```
Expected: `file=release/PaperDesk-0.1.0-arm64.dmg`

- [ ] **Step 2: 验证打包二进制(ABI + userData 隔离)**

```bash
cd /Users/zhangyixuan06/work/paperdesk
( ./release/mac-arm64/PaperDesk.app/Contents/MacOS/PaperDesk >/tmp/pd.log 2>&1 & )
sleep 8
grep -iE "NODE_MODULE_VERSION|different Node" /tmp/pd.log && echo "FAIL-ABI" || echo "OK-ABI"
ls ~/Library/Application\ Support/paperdesk/ && echo "OK-USERDATA"
pkill -f "PaperDesk.app/Contents/MacOS"; rm -f /tmp/pd.log
```
Expected: `OK-ABI` 且 `OK-USERDATA`(paperdesk 目录被创建,与 paperlens/ 互不干扰)。

- [ ] **Step 3: 安装并存 + 窗口验证**

```bash
cd /Users/zhangyixuan06/work/paperdesk
cp -R release/mac-arm64/PaperDesk.app /Applications/
xattr -dr com.apple.quarantine /Applications/PaperDesk.app 2>/dev/null
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
rm -rf release/mac-arm64 release/mac && "$LSREG" -kill -r -domain local -domain system -domain user 2>/dev/null
open -a /Applications/PaperDesk.app && sleep 4
pgrep -f "PaperDesk.app/Contents/MacOS/PaperDesk" >/dev/null && echo "OK-RUNNING"
ls -d /Applications/PaperLens.app /Applications/PaperDesk.app
```
Expected: `OK-RUNNING` + 两个 .app 并列存在;用 Swift CGWindowList 或截图确认 PaperDesk 窗口出现(空库+未配置状态属正常)。

- [ ] **Step 4: Commit + 推分支**

```bash
cd /Users/zhangyixuan06/work
git add -A && git diff --cached --quiet || git commit -m "feat(paperdesk): L0 完成——PaperDesk 与 PaperLens 并存安装,基线跑绿"
git push -u origin paperdesk
```

---

## L1-L4 概要(待各批开工前细化为独立 plan)

- **L1 数据层+双源迁移**:lib_papers/lib_folders/lib_paper_folders 表;library-repo;首启检测旧 PaperLens → 整库拷贝(含 models/ 缓存);zotero-import(元数据/文件夹/PDF 拷贝,key 沿用);IPC `zotero:list`/`zotero:collections`/`paper:pdf` 等换读本地库;真库迁移验证(20 篇+笔记/高亮/1789 向量块)。
- **L2 入库**:metadata-fetch(DOI→Crossref、arXiv→export API,注入 fetch 可单测);「+ 添加论文」弹窗(贴号/拖 PDF/手动填);arXiv 自动下 PDF。
- **L3 管理**:文件夹增删改、论文元数据编辑/移动/级联删除、空库引导页。
- **L4 收尾**:设置区块调整(Zotero→一次性导入;文献库目录)、退役高亮同步按钮、全回归、打包真机验收。
