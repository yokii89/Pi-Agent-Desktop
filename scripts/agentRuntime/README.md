# Electron / Durable 验证

`pnpm check:agent-runtime` 在 Windows x64 上运行实际 Electron，包括构建后的工作台。宿主与 utility process 均不通过 `ELECTRON_RUN_AS_NODE` 替代。

脚本编译主进程、独立 runtime、renderer 和临时 Electron 验收入口，先运行开发态，再复用 `electron-builder.yml` 的生产依赖收集与 ASAR 规则生成 `win-unpacked`，运行其中的 `PiDesk.exe`。检查包仅替换入口和输出目录，不发布产物、不执行安装器。窗口、preload、业务 IPC、会话投影和运行时均来自应用的生产构建；临时入口负责隔离 profile、提供本地模型服务和驱动界面。

检查结束后删除 `dist/runtimeCheck/`。报告和界面截图保留在被 Git 忽略的 `temp/agent-runtime-check/`：

- `development.json` / `packaged.json`：对应环境的依赖、Node 版本、SQLite、工作台、故障结算和恢复结果。
- `development-restored.png` / `packaged-restored.png`：从侧栏重新打开保存历史后的实际界面。
- `development-fault.png` / `packaged-fault.png`：生成过程中 utility process 被终止后的实际界面。
- `public-provider.json` / `public-provider.png`：显式运行公网验证时保存的结果；后续本地验证不会覆盖它们。
- `workbench-failure.png` / `workbench-failure.txt`：仅在工作台验收失败时输出，便于定位界面问题。

打包目录保留在系统临时目录的 `pidesk runtime 包验证-*` 下，具体路径记录在 `packaged.json`，避免缺失依赖回退到项目 `node_modules`；同时覆盖带空格和中文的路径。

## 默认检查

开发态和打包态均覆盖：

- 从应用自己的依赖树导入 `@google/genai`，用其实际 `protobufjs` 依赖完成编解码；打包态确认解析结果位于 ASAR。
- 经生产 `AgentRuntimeManager` 创建 utility process，通过 MessagePort 握手，记录实际 Node 版本。
- 内部 SQLite 检查使用 faux model，覆盖同 UUID 并发打开、同 requestId 去重、工具结果保存、关闭重开和初次水合无增量重放。
- 工作台检查通过真实编辑器输入、发送按钮和侧栏历史按钮，走 preload → 主窗口 IPC → MessagePort → `DesktopRuntime` → SQLite → 投影 → renderer 的完整链路。
- 本地 OpenAI 兼容 SSE 服务返回一次 `read` 调用，实际读取验收工作区的 `fixture.txt`，收到工具结果后再返回最终回答。确认用户消息不重复。
- renderer reload 后重新打开历史，以及关闭会话后重新打开 SQLite，均恢复回答且不增加模型请求、不重放完成事件。
- 生成过程中通过捕获的专属 `UtilityProcess` 对象强制终止写者，确认在途请求被拒绝、会话只推送一次 error 和 exit、界面显示 Interrupted 和错误提示、发送按钮退出 Stop 状态。
- 重新从侧栏打开会话，启动新 utility process，恢复持久任务并完成回答；先前保存的回答仍在，用户消息没有重复。
- 正常关闭 runtime，确认关闭后拒绝再次启动；打包态断言应用路径位于 `app.asar` 内。

默认检查只请求本机临时模型服务。每次 Electron 运行使用新 profile、验收项目和数据库；utility process 沿用生产的空环境变量配置。工作台沿用现有历史目录发现逻辑，但测试会话写入独立 profile，不修改日常会话或模型配置。

## 显式公网验证

用户已授权真实模型请求时运行：

```sh
pnpm check:agent-runtime --live
```

`--live` 在开发态工作台中额外读取本机 `~/.pi/agent/auth.json` 的 `newapi` 账号配置，使用其中的公网地址、API 类型、首选模型和 access 凭证。它只接受 HTTPS，以 `/v1` 为接口根，最大输出设为 256 token，发送一次要求精确返回随机标记且不调用工具的消息。随后确认标记出现在助手正文、会话正常结算，以及 renderer reload 后能从侧栏恢复回答。打包态继续使用本地 SSE 服务，不重复公网验证。

凭证仅在主进程中读取，通过生产 settings 模块以 safeStorage 加密写入独立验收 profile，结束时删除该模型配置文件；日志、JSON 报告和截图不包含凭证。此入口验证本机已有的网关账号，不负责账号登录或令牌续期。

若本次修改仅涉及验收脚本，且当前源码已经构建，可加 `--reuse-build` 跳过三层应用构建；临时验收入口仍重新编译。应用源码变化后使用默认完整构建。

## 环境与范围

前置条件是已安装完整的 Electron 二进制。可运行 `pnpm rebuild electron` 和 `pnpm exec electron --version` 检查；安装脚本退出码不能代替实际执行验证。

本轮结果见 [桌面业务验收记录](../../DURABLE-MIGRATION/P1-DESKTOP-ACCEPTANCE.md)。本脚本覆盖工作台会话主链路与 utility process 中断恢复；NSIS 安装/卸载、应用或系统整体崩溃、其他模型供应商/API 类型、全部扩展/MCP/远程能力和其他工作台资源仍按各自范围验收。
