# Electron / Durable 验证

`pnpm check:agent-runtime` 在 Windows x64 上运行实际 Electron，而非通过 `ELECTRON_RUN_AS_NODE` 使用系统 Node 替代宿主。

验证脚本编译主进程、独立 runtime 和临时 Electron 入口，先运行开发态，再复用 `electron-builder.yml` 的生产依赖收集与 ASAR 规则生成 `win-unpacked`，运行其中的 `PiDesk.exe`。仅替换检查包的入口和输出目录，不发布产物、不启动正常工作台。检查结束后删除 `dist/runtimeCheck/`；JSON 报告保留在被 Git 忽略的 `temp/agent-runtime-check/`。打包目录保留在系统临时目录的 `pidesk runtime 包验证-*` 下，具体路径记录在 `packaged.json`，避免缺失依赖回退到项目 `node_modules`；同时覆盖带空格和中文的路径。

两种环境均检查：

- 从应用自己的依赖树导入 `@google/genai`，并用其实际 `protobufjs` 依赖完成一次编解码。
- 经生产 `AgentRuntimeManager` 创建 utility process，通过 MessagePort 完成握手，记录其实际 Node 版本。
- 经实际 `DurableSessions` 服务并发打开同一 UUID 会话，确认共享 Harness；使用同 requestId 并发提交，确认只执行一次。
- 使用 faux model 完成工具调用和最终回答，写入真实 `node:sqlite` 数据库，确认工具结果已保存且 entries 推送不重复。
- 关闭并重开会话后核对保存的回复、requestId 去重和初次水合无增量重放。数据库位于受控临时根的 UUID 子目录中。
- 关闭 runtime，确认关闭后拒绝再次启动；打包态同时断言应用路径位于 `app.asar` 内。

检查使用独立 profile 和临时数据库；utility process 沿用生产的空环境变量配置，不读取真实会话、凭证，不请求模型 API。SQLite 往返在生产 utility process 内执行，开发态和打包态使用同一入口。

前置条件是已安装完整的 Electron 二进制。可先运行 `pnpm rebuild electron` 和 `pnpm exec electron --version`。若安装脚本报告成功但 `path.txt` 或二进制仍缺失，必须检查官方 ZIP 及其解压结果，不能把退出码 0 当作环境恢复成功。本次本机恢复中，缓存 ZIP 已按 Electron 包自带的 `checksums.json` 校验 SHA-256，再通过 Windows `Expand-Archive` 解压到 Electron 的 `dist/`，最后重新核对版本及实际执行结果。

该检查覆盖打包目录和 ASAR 中的 runtime、SQLite、内部会话服务和上述依赖；会话 / 投影的边界与待办见 [P1 实施记录](../../DURABLE-MIGRATION/P1-SESSION-FOUNDATION.md)。NSIS 安装/卸载、崩溃恢复、真实模型调用、WASM/worker 资源和完整工作台迁移仍需各自验收。
