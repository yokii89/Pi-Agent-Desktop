# AGENTS.md — PiDesk 开发规范

本文件是 PiDesk 的开发约定。所有代码（包括 AI 生成的代码）必须遵守，避免实现不统一。

核心开发原则 本项目优先考虑长期可维护性，而不是用最少文件快速完成需求。 当“直接写进现有页面”和“创建职责清晰的新组件”都可以完成需求时，优先选择后者。 但不要过度组件化： 一个只有少量静态 DOM、没有独立职责、不会复用的 UI 片段，不需要单独创建组件。 判断组件边界的核心标准是“职责”，而不是代码行数。

## SDK 与界面扩展开发

后续新增或修改公开 SDK、View 协议、界面挂载点、静态贡献入口、扩展生命周期及宿主桥接时，开发前先明确契约、作用域、生命周期与兼容方案，交付时完成对应验证。仅增加类型或界面入口不视为完成能力开放；尚未实现的能力必须明确标注，不能作为现有 API 对外承诺。

## 项目概述

PiDesk 是 [pi](https://github.com/earendil-works/pi) 的 Windows 桌面客户端，基于 Electron + React + TypeScript。

## 开发与热更新

开发入口是 **`pnpm dev`**（`scripts/dev.mjs`），一条命令覆盖三层热更新。**故意不引入 electron-vite / vite-plugin-electron**：它们会接管构建产物布局，而本项目主进程走 `tsc → dist/main`、渲染层走 `vite → dist/renderer`，为省一点编排把构建链路交出去不划算。因此仅用 Node 内置能力编排，**零新增依赖**。

链路与边界：

| 改动范围 | 生效方式 | 是否需要重启 |
|---------|---------|------------|
| `src/renderer/**` | Vite dev server 原生 HMR | 否（热替换模块） |
| `src/main/**`、`src/preload/**`、`src/shared/**` | tsc 增量编译 → 重启 Electron | 是（自动） |

- **dev/prod 分流靠环境变量**：`scripts/dev.mjs` 注入 `PIDESK_DEV_SERVER_URL`，`createMainWindow` 有值时 `loadURL` 并打开 detached DevTools，无值时 `loadFile(dist/renderer/index.html)`。用环境变量而不是 `app.isPackaged`，是为了让 `pnpm start`（本地跑构建产物）仍走 `loadFile`。**生产、打包行为不受影响。**
- **端口不写死**：从 Vite 的 `resolvedUrls.local[0]` 取实际地址传给 Electron，5173 被占用自增端口也能工作。
- **开发态 CSP**：`src/renderer/index.html` 里的 CSP 是生产用的严格策略，由 `vite.config.ts` 的 `pidesk:dev-csp` 插件（`apply: "serve"`）在开发态替换为放宽版本——React Refresh 需要内联脚本，HMR 需要 `ws:`。**新增/收紧 CSP 指令时两边都要改**，否则开发态白屏、生产态放水。
- **主进程编译失败不重启**：保留当前实例并在终端报错，避免陷入「一改动就打开即崩」的循环。
- **DevTools 自身报错在启动器层过滤**：自动打开的 detached DevTools 每次 attach 都会让 DevTools 前端报
  `Request Autofill.enable / Autofill.setAddresses failed`（Electron 未实现该 CDP 域，electron#41614 官方 wontfix）。
  这类日志由 Chromium 直接写 stderr，**不经过 `webContents` 的 `console-message`**，应用侧拦不住，
  因此由 `scripts/dev.mjs` 按行过滤（`scripts/devtools-noise-filter.mjs`，其余 stderr 一律原样透传）；
  需要看原始输出时设 `PIDESK_SHOW_DEVTOOLS_NOISE=1`。**不要用 `--log-level` 全局降级来消音**，那会连带吞掉 GPU 崩溃等真实诊断。
- **locale 对齐避免 `language-mismatch`**：Electron 只打包 en-US 的 DevTools 文案，进程 locale 为 zh-CN 时 DevTools 会刷
  `Unknown VE context: language-mismatch`。`scripts/dev.mjs` 默认给 Electron 加 `--lang=en-US` 从源头对齐；
  用户透传覆盖 `--lang` 时，上述噪声过滤器仍会兜底吃掉这条报错。
- `pnpm dev:renderer` 只起 Vite dev server、不拉 Electron，用于在纯浏览器里调渲染层。
- 关闭应用窗口即结束整条开发链路（dev server 一并关闭），要重开就再跑一次 `pnpm dev`。

## 技术栈（固定，不得擅自替换）

| 层 | 选型 | 说明 |
|----|------|------|
| 包管理器 | pnpm | 唯一包管理器，通过 `packageManager` 字段锁定版本；禁止使用 npm / yarn |
| 桌面框架 | Electron | 不要引入 Tauri / Wails / WebView2 原生壳 |
| 前端框架 | React 19 + JSX | 函数组件 + Hooks，禁止 class 组件 |
| 构建工具 | Vite | 渲染进程用 Vite；主进程用 tsc 编译 |
| 语言 | TypeScript（strict） | 所有新文件一律 `.ts` / `.tsx`，禁止 JS |
| 图标 | **Phosphor Icons（`@phosphor-icons/react`）** | UI 图标唯一图标库，见下文规范；文件类型图标为资源型资产，见"文件类型图标"一节 |
| 样式 | CSS / CSS Modules | 暂不引入 Tailwind 等框架，如需变更先在本文件登记 |
| 代码质量 | Biome | 格式化 + Lint 一体，配置沿用 pi 仓库的 `biome.json`，禁止再引入 ESLint/Prettier |
| 测试 | vitest | 仅用于 `packages/view-sdk` 与可纯测的主进程协议逻辑（如 `viewHostProtocol`）；不引入渲染层测试框架 |
| pi 会话集成 | pi `--mode rpc`（JSONL over stdio） | 中央会话区唯一方案：主进程以子进程驱动 pi RPC，渲染层**完全自研 UI**（见下文"中央会话区规范"）；禁止内嵌 pi TUI |
| 独立终端 | node-pty + @xterm/xterm | 仅用于中央工作区底部的终端面板（Bottom Panel）；禁止用于 pi 会话 |
| 打包 | electron-builder | 仅针对 Windows：NSIS 安装包，配置进仓库（编排脚本 `scripts/package.mjs`，CI 分发见 `.github/workflows/release.yml`） |

任何新增依赖（运行时或开发时）必须先在此处登记用途，再安装。

已登记依赖补充说明：

- `@types/node`（dev）：主进程 / 预加载的 Node API 类型，TypeScript strict 必需。
- `@phosphor-icons/react`（runtime）：唯一图标库，见上文图标规范。
- `@xterm/addon-fit`（runtime）：xterm 终端的容器尺寸自适应插件，与 `@xterm/xterm` 配套使用（仅中央工作区底部的终端面板）。
- `react-markdown` + `remark-gfm`（runtime）：会话区 AI 回复的 Markdown 文档流渲染（GFM 表格/任务列表/删除线）。
- `remark-breaks`（runtime）：会话正文与思考流的软换行渲染为 `<br>`（模型输出的单换行是段内换行语义）；仅 `MarkdownDoc` 的 `breaks` surface 使用，文件面板预览与 ExtensionView 不开。
- `gsap`（runtime）：左侧边栏的展开/折叠、悬浮揭示等交互动效；**必须动态 `import()` 使用**（见下文"动效规范"），不得静态引入。
- `@electron/rebuild`（dev）：`node-pty` 原生模块针对 Electron ABI 的重编译（`pnpm run rebuild:native`）。
- `sql.js`（runtime）：主进程用 WASM SQLite 读取本机 Chromium Cookie 库副本（浏览器登录态导入）；不引入 native SQLite。
- `shiki`（runtime）：右侧「文件」面板只读预览的代码语法高亮（TextMate 文法 + 双主题 CSS 变量）；经 `shiki/core` 细粒度动态加载，禁止整包 `import "shiki"` 静态引入。
- `@vitest/coverage-v8`（dev）：`packages/view-sdk` 的行/分支覆盖率口径（`pnpm test:sdk:coverage`）。版本必须与 `vitest` 主版本配对；**仅 SDK 测试用**，不扩展到主进程 / 渲染层（后者仍按本文件"测试"条款只跑断言）。`NODE_V8_COVERAGE` 对 vitest worker 无效，不要再试。
- `electron-updater`（runtime）：设置 →「应用更新」的检查/下载/安装。GitHub Releases + NSIS `latest.yml`/blockmap；发布流程见 `scripts/release.mjs` 与 `.github/workflows/release.yml`。

多模态图片附件**零新依赖**：解码/缩放用浏览器 `createImageBitmap` + `canvas`，不引入 sharp / jimp 等图像库。

## Phosphor Icons 使用规范

- 统一从 `@phosphor-icons/react` 导入，**禁止**内联 SVG、emoji、或混入其他图标库（如 lucide、Material Icons）。
- 导入方式：命名导入具体图标，如 `import { Play, GearSix } from "@phosphor-icons/react";`，不要 `import * as Icons`。
- 图标风格（weight）全应用统一为 **`"regular"`**；强调/选中态用 `"fill"`。不得在一处用 `"duotone"` 另一处用 `"bold"`。
- 尺寸通过 `size` 属性传递数字（如 `size={20}`），图标尺寸遵循 16 / 20 / 24 三档：行内文字旁 16，工具栏 20，页面级 24。
- 颜色继承 `currentColor`，不单独给图标指定颜色，由父级文字颜色控制。

```tsx
import { Play } from "@phosphor-icons/react";

<button><Play size={20} weight="regular" /> 运行</button>
```

## 文件类型图标（文件树资源型图标）

- **用途与边界**：文件树等处按文件后缀/文件名展示的语言与文件类型图标（如 ts、py、docker 的彩色 logo）。这类图标属于**资源型 SVG 资产**，不适用上文 Phosphor 唯一图标库条款；UI 图标（按钮、工具栏、占位符）与**文件夹图标**仍必须使用 Phosphor。
- **来源**：[peakoss/vscode-jetbrains-icon-theme](https://github.com/peakoss/vscode-jetbrains-icon-theme) 的 2023 图标集；原始图标出自 JetBrains Design Resources（Apache 2.0），上游主题映射代码为 MIT。许可全文与出处说明随资产存放在 `src/renderer/fileIcons/LICENSE.md` / `NOTICE.md`，**不得删除**。
- **结构**：SVG 位于 `src/renderer/fileIcons/assets/{light,dark}/`（同名图标两套主题，内容与上游一致，仅文件名归一化）；映射数据在 `src/renderer/fileIcons/mapping.ts`（**生成物，禁止手改**，已从 Biome 检查中豁免）；解析逻辑在 `resolve.ts`（文件名精确命中 → 后缀最长匹配 → 兜底图标），组件封装为 `fileIcons/FileIcon.tsx`（内部经 `useUiStore` 感知主题）。
- **主题适配**：暗色主题优先使用上游 `_dark` 变体，缺失时自动回退浅色图标。
- **更新**：`pnpm run gen:file-icons`（`scripts/generate-file-icons.mjs`，需要网络）重新拉取并生成；要扩大覆盖范围时修改脚本/上游数据，不手改生成物。该脚本仅在更新图标集时手动运行，日常构建不依赖网络。

## 第三方 logo 资产

- `src/renderer/assets/ai-logos/*.svg` 为第三方 logo 资产，已从 Biome 检查中豁免（Biome 会把 SVG 误当 HTML/CSS 解析报错）。

## Electron 架构规范

- **进程边界**：主进程（`src/main`）、预加载（`src/preload`）、渲染进程（`src/renderer`）职责不得混用。
  - 主进程：窗口管理、子进程（pi 会话）管理、文件系统、原生 API。
  - 预加载：仅通过 `contextBridge.exposeInMainWorld` 暴露白名单 API，命名空间统一为 `window.pidesk`。
  - 渲染进程：纯 React UI，**禁止**直接 `require` Node 模块、禁止 `nodeIntegration`。
- 主/渲染通信一律使用 `ipcMain.handle` / `ipcRenderer.invoke`（请求-响应）或 `webContents.send`（主进程推送，如终端流式输出）。
- IPC channel 命名：`"pidesk:<域>:<动作>"`，如 `"pidesk:session:start"`、`"pidesk:session:output"`。
- **返回值统一信封**：请求-响应类 handler 一律返回 `{ ok: true, data }` 或 `{ ok: false, error: string }`，渲染层通过统一工具函数（如 `unwrap()`）解包，禁止 handler 直接 throw 或返回裸值。
- **终端流式输出消息格式固定（仅中央工作区底部的终端面板）**：主进程推送的消息为 `{ type: "data" | "exit" | "error", payload: string | number }`；多实例域（终端 Tab）在此基础上附加 `id` 字段以区分实例，渲染层按 `type` 分发，不得发明其他结构。面板可见性与终端进程生命周期是两个独立概念：隐藏面板不得 kill pty。
- **会话推送消息格式固定（中央会话区）**：主进程推送的消息为 `{ sessionId, type: "event" | "eventBatch" | "exit" | "error", payload }`（多实例并行：对齐终端条款，**必带** `sessionId`）；`event` 时 `payload` 为单条 pi RPC 事件对象，`eventBatch` 时为约 32ms 合批后的事件数组（边界事件仍走单条 `event` 并立即 flush）；事件经白名单转发，类型见 `src/shared/ipc.ts`，渲染层按 `sessionId` 路由到对应会话桶，不得发明其他结构。同 `sessionFile` 至多一个存活进程；切换 active / 隐藏不 kill，手动结束只走侧栏行菜单「结束进程」。
- 渲染进程访问的 API 必须在 `src/preload` 中定义并在 `src/renderer/global.d.ts` 中补充类型声明。

### 主进程代码组织

- 按功能模块拆分：`src/main/session/`（pi 会话 RPC 驱动）、`src/main/terminal/`（独立终端）、`src/main/window/`（窗口）、`src/main/ipc/`（IPC 注册）等。
- 每个 IPC handler 就近放在对应功能模块内，并在 `src/main/ipc/index.ts` 集中注册，禁止把逻辑堆进 `src/main/index.ts`。

### 中央会话区规范（自研会话 UI）

- **架构**：pi 以 `--mode rpc` 子进程运行（stdin/stdout 严格 JSONL，LF 分隔）。主进程（`src/main/session/`）只负责传输层：进程生命周期、行分割、请求-响应按 `id` 关联、事件白名单转发；消息组装与渲染全部在渲染层。禁止再以内嵌 pty + xterm 方式承载 pi 会话。
- **渲染规则（固定，不允许做成传统聊天 UI）**：
  - 用户消息：**可用气泡**（右对齐、强调底色）。
  - AI 回复：**一律文档流渲染**（Markdown 全宽排版），**禁止气泡**；AI 输出是"文档"，不是聊天气泡。
  - 工具调用：单条为紧凑状态行（图标 + 主体 + 状态，可展开结果）；连续 ≥2 条收成可折叠摘要头（「已读取 4 个文件 · 已搜索 2 次」）。默认一律收起，不跟随 running 自动展开，避免对话流跳动。
  - 思考（thinking）内容：默认折叠成一行（「思考中 / 思考过程」），点开才渲染 muted Markdown，不套卡片壳。
- **流式渲染数据源**：`message_update`（text/thinking/toolcall delta，按 `contentIndex` 组装）做增量显示；`message_end` 与 `get_messages` 为权威数据，用于对账与会话恢复。用户消息由渲染层发送时乐观插入，忽略 pi 回显的用户角色消息事件，避免重复。
- 会话历史仍以 pi 原生 JSONL 为准（`~/.pi/agent/sessions/`），恢复会话用 `--session <file>` 启动参数；PiDesk 不自建会话存储。

## 数据持久化

- 用户设置（主题、pi 可执行文件路径等）统一存放在 `app.getPath("userData")` 下的 JSON 文件，由 `src/main/settings/` 模块集中读写并缓存，渲染层只能通过 IPC 访问。
- 禁止在业务代码里散落 `fs.writeFile` 写配置；新增持久化数据先加进 settings 模块的 schema。

## 界面多语言

- 支持 **zh-CN / en-US**，设置项 `locale`（`system` | `zh-CN` | `en-US`）持久化在 `userData/settings.json`。
- **零新依赖**：文案表在 `src/shared/i18n/locales/*.ts`（`defineMessages`，各语言并排）；组件用 `useT()`，非组件代码用 `shared/i18n` 的模块级 `t`。
- 只抽 **用户可见** 字符串；源码注释、测试描述保持原样。键名扁平点分（`common.*` / `settings.*` / `session.*` 等）。
- 新增文案必须同时补 `zh-CN` 与 `en-US`；插值用 `{name}` 占位。

## 主题与颜色令牌

- 所有颜色、间距、字号只允许引用 `src/renderer/styles/tokens.css` 中定义的 CSS 变量（如 `var(--color-bg)`），组件内禁止写死色值。
- 主题切换通过在根元素切换 `data-theme` 属性实现（如 `data-theme="dark"`），tokens.css 为每套主题提供同名变量。
- 磨砂玻璃（顶栏 + 左右侧栏）的**配方**集中在 `src/renderer/styles/glass.module.css`，组件用 CSS Modules 的 `composes` 复用，不要在组件里重写一套玻璃属性；相关令牌为 `--glass-*`。应用背景为纯平色（`--color-bg`），**不得铺彩色环境光/径向渐变**（旧 `--ambient-glow-*` 会在窗口四角透出彩色光斑，已移除）；面板分隔靠各自的 `--glass-border`。
- tokens.css 当前为占位初始值，调整色板以更新该文件为准。

## 代码风格

- 遵循仓库根目录 `tsconfig.json` 的 strict 配置，不允许用 `any` 逃避类型（必要时用 `unknown` + 收窄）。
- 组件文件用 PascalCase（`SessionView.tsx`），其他模块用 camelCase（`sessionStore.ts`）。
- 状态管理：优先 React 内置（`useState` / `useReducer` / Context），规模变大再统一引入状态库——引入前先在本文件登记。
- 注释只写"为什么"，不写"是什么"；公共 API（导出函数、IPC 接口）写 JSDoc。
- **换行一律 LF**，仓库根两个文件各管一层：`.gitattributes`（`* text=auto eol=lf`）管 **git 入库/检出**归一，
  `.editorconfig`（`end_of_line = lf`）管**编辑器别写出 CRLF**——`biome check` 读的是工作区文件，只有后者拦得住它。
  另注意 `.gitattributes` 在本机是「无差别」的（`core.autocrlf=true` 恰好也归一），它的价值在别的机器 / CI 上。
  遇到「format 报错但内容只有 CR 字符」，先看 `git ls-files --eol | grep w/crlf`，不要怀疑代码。

## 动效规范

交互动效统一用 **GSAP**（`gsap`），但必须遵守以下约定：

- **动态加载**：只允许通过 `src/renderer/utils/animation.ts` 的 `loadGsap()` 使用，
  禁止 `import { gsap } from "gsap"` 静态引入——GSAP 会被切成独立 chunk 按需下载，
  静态引入会把它塞回主 bundle，拖慢启动。
- **时长与缓动集中在** `src/renderer/utils/motionTokens.ts`（`NAV_MOTION`），
  组件内禁止写裸数字时长。
- **必须尊重 `prefers-reduced-motion`**：调用 `prefersReducedMotion()`，
  命中时直接落到终态、不播动画。
- **颜色/间距仍然只用 `tokens.css` 变量**，GSAP 只负责"随时间的数值变化"。
- **动画不得写死终态到 DOM**：补间结束后清除内联样式（高度/溢出/will-change），
  避免与 CSS 的 `height: auto`、响应式布局冲突。
- **高度展开/收起不要用 CSS**：`grid-template-rows: 0fr → 1fr` 在 Chromium 上
  起始值为 0fr 时不补间，`height: auto` 不可插值；用 `useCollapseAnimation` 走
  GSAP 补间实测像素高度。
- **关键可交互元素（按钮等）的可见性不能只依赖 JS**：用 CSS 的
  `:hover` / `:focus-within` 兜底，否则动画中断时键盘用户会聚焦到透明元素上。
  GSAP 只改自定义属性（如 `--reveal`），真实 `opacity` 交给 CSS 决定。

## Git 约定

- 分支：`main` 为稳定分支，功能开发用 `feat/<主题>`、修复用 `fix/<主题>`。
- 提交信息遵循 Conventional Commits：`feat:` / `fix:` / `chore:` / `docs:` / `refactor:`。
- **唯一公开仓库是 `yokii89/Pi-Agent-Desktop`**（`yokii89/PiDesk` 已停用，不再推送）：更新源写死在 `electron-builder.yml` 的 `publish.repo` 与 `src/shared/update.ts` 的常量里，改这两处等于改线上客户端的升级通道。
- 本地 `main` 就是发布仓库的 `main`：`git push origin main` 直接生效，提交逐条公开可见。发版是 `pnpm release x.y.z`（本地 bump + commit + tag，不自动推）之后按脚本提示 `git push origin main` 与 `git push origin v<版本>`，推 tag 触发 CI 构建并创建 Release。
