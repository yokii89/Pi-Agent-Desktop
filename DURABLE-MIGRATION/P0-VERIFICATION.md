# P0 依赖与 Electron 实测记录

本记录覆盖独立运行时的本机可运行性与打包依赖，不表示业务会话迁移或 P0 的全部验收已经完成。

## 依赖脚本与完整性

依赖链为 `pi-durable / pi-ai 1.6.0 → @google/genai 2.32.0 → protobufjs 7.6.6`。

- `@google/genai`：发布包已包含运行时代码，安装阶段的 `preinstall` 只输出 no-op；在 `allowBuilds` 中显式设为 `false`，替换待决占位值。包里的 `prepare` 属于源码准备流程，不是本项目安装发布包所需步骤。
- `protobufjs`：核对 `scripts/postinstall.js` 后设为 `true`。脚本仅检查依赖版本范围，不下载文件或编译原生产物；已实际执行。
- `pnpm install --frozen-lockfile` 成功，安装不再报告这两个包的待决脚本；`@google/genai` 保留为明确禁用项。
- 在 Electron 开发态与项目目录外的打包态分别导入 Google SDK、完成 protobuf 编解码；打包态还断言两个模块均解析到应用自身的 ASAR 内。

## Electron 恢复

本机 `electron@41.0.3` 初始缺少 `path.txt` 和可执行文件，`dist/` 仅有不完整的 locales。重新执行安装脚本虽返回成功，文件仍不齐。

核对缓存的官方 `electron-v41.0.3-win32-x64.zip`：75 个条目，142524457 字节；SHA-256 与 Electron 包自带的 `checksums.json` 一致：

```text
93346b31dfcd779c4c4cdfdfb2e3f9642e7a9888e388a8971ff3e95dbf948887
```

通过 Windows `Expand-Archive` 解压并恢复 `path.txt` 后，`pnpm exec electron --version` 输出 `v41.0.3`，后续冻结锁文件安装后仍可启动。

## 实测发现并修复的问题

- runtime 构建脚本位于 `type: module` 的 scripts 作用域，却使用 `require`；已改为 ESM。
- NodeNext 将共享协议编译为 CommonJS，原构建却把整个 runtime 输出目录标为 ESM，导致 utility process 报缺失命名导出。现在输出根明确为 CommonJS，仅 `agentRuntime/` 子目录沿用源码 ESM 标记。
- 打包入口统一调用同一个 runtime 构建脚本，避免开发、普通构建与打包的模块作用域漂移。
- manager 的 smoke-test 缓存将数字 conversation ID 写成字符串；已与实际协议统一。
- faux model 返回的 `done` 状态仍允许缺少 answer，新增检查后才读取答案。
- utility process 原先丢弃 stderr，启动只报告退出码；现在保留有限长度的诊断并随失败返回。

## 通过的验证

`pnpm check:agent-runtime` 已在两个环境完成：

| 检查项 | 开发态 Electron | 项目目录外的 win-unpacked / ASAR |
| --- | --- | --- |
| Electron 版本 | 41.0.3 | 41.0.3 |
| utility process 实际 Node | 24.14.0 | 24.14.0 |
| Google SDK 导入 | 通过 | 通过，模块位于 ASAR |
| protobuf 编解码 | 通过 | 通过，模块位于 ASAR |
| MessagePort 握手与并发启动 | 通过 | 通过 |
| faux model 完成一轮对话 | 通过 | 通过 |
| SQLite 关闭重开后读取保存的回复 | 通过 | 通过 |
| runtime 关闭与关闭后拒绝启动 | 通过 | 通过 |

打包验证复用生产配置的依赖收集、ASAR 规则和 Electron 分发文件，仅替换检查入口；包放在系统临时目录的中文与空格路径下，utility process 使用独立 profile 和空环境变量。报告在 `temp/agent-runtime-check/development.json` 与 `packaged.json`，具体产物位置记录在后者。

补充检查：`pnpm typecheck`、runtime 协议 Vitest（2 项）和相关文件 Biome 检查通过；系统 Node 下的 `pnpm test:agent-runtime` 也已通过。

## 尚未覆盖

- NSIS 安装、卸载与没有外部 pi / Node 的干净机器验收。
- utility process 强制崩溃后的任务恢复、工作台业务会话切换与完整扩展能力。
- 真实模型请求、Photon WASM、图片 worker、QuickJS 等后续按需功能及资源路径。

执行入口和隔离方式见 [验证命令说明](../scripts/agentRuntime/README.md)。
