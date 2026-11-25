# P1 桌面业务链路验收

本轮已完成实际 Electron 工作台的创建、发送和历史恢复，生产协议在 ASAR 内的执行，utility process 异常退出后的端到端结算与 SQLite 续跑，以及一次公网模型请求。它补充并取代 [内部会话基础记录](./P1-SESSION-FOUNDATION.md) 中对应的前端接入和真实请求待验收项；其他迁移能力仍按总方案逐项验收。

## 静态检查与纯逻辑验证

- `pnpm exec biome check .`：全部受检查文件通过，无错误、无警告。修复了格式、导入顺序和未使用导入；补上历史打开回调的 `startBucket` 依赖，移除恒定 `piReady` 的多余依赖。
- `pnpm typecheck`：主进程、独立 ESM runtime、renderer 三层通过。协议校验提前保存已收窄的 conversation ID，避免数组回调内访问 `unknown`。
- `pnpm exec vitest run --config src/main/vitest.config.ts agentRuntime`：4 个文件、19 项测试通过。
- `pnpm exec vitest run --config src/renderer/vitest.config.ts stores/sessionBuckets.test.ts stores/sessionTranscript.test.ts`：2 个文件、79 项测试通过。

## 实际 Electron 与 ASAR

环境为 Electron 41.0.3，utility process 内实际 Node 24.14.0。使用生产 renderer、preload、IPC、MessagePort、桌面运行时和会话投影，验收入口只负责独立 profile、本机 SSE 服务及界面驱动，未增加依赖或渲染测试框架。

开发态与独立临时目录下的 `win-unpacked/PiDesk.exe` 均通过以下检查；后者确认应用根为 `resources/app.asar`，包括生产依赖解析和实际运行时文件读取。

| 场景 | 实际检查 | 结果 |
| --- | --- | --- |
| 创建发送 | 点击 New task，通过编辑器输入和 Send 按钮发送 | 通过 |
| 工具执行 | SSE 模型调用内置 read，读取验收工作区文件；后续请求包含真实工具结果，最终回答显示在助手文档流 | 通过 |
| renderer 恢复 | reload 后展开项目，从侧栏打开同一会话；已保存回答恢复，模型请求数和完成事件数不增加 | 通过 |
| SQLite 重开 | 关闭会话，再从侧栏打开；保存回答恢复，只有一条初始用户消息 | 通过 |
| 在途请求结算 | 生成中发起 snapshot 并终止专属 utility process；等待中的请求被拒绝 | 通过 |
| 故障界面结算 | 同一会话仅收到一次 error 和 exit；当前 run 显示 Interrupted，错误可见，按钮退出 Stop 状态 | 通过 |
| utility 重启恢复 | 从侧栏重新打开，启动新写者，恢复持久任务、完成回答；先前回答仍在，共两条用户消息 | 通过 |
| 退出 | 正常 shutdown 后拒绝重新启动同一 manager | 通过 |

每个环境的本地 SSE 服务共收到 4 次生成请求：工具调用、收到工具结果后的最终回答、被终止的生成、重启恢复后的生成。历史水合和会话关闭重开没有额外生成请求。

通过 `UtilityProcess.kill()` 对捕获的确切对象注入退出，没有终止日常 PiDesk 实例。Windows 下强制终止可能回报进程退出码 0；应用仍通过缺少正常关闭流程识别运行时消失，向会话发布错误及失败 exit 信封，界面结束忙碌状态。

报告为被 Git 忽略的 `temp/agent-runtime-check/development.json` 和 `packaged.json`，恢复与故障截图同目录保存。验收后临时 host 已删除，独立 profile 中的加密模型文件也已删除。

## 公网模型请求

使用用户已配置的网关账号，在实际开发态工作台经 OpenAI Responses 发送短请求：

- 网关：`api.xingchiapi.com`。
- 模型：`gpt-6.1-sol`。
- 要求：只返回一个随机标记，不调用工具，最大输出 256 token。
- 实际回答：`PUBLIC_OK_c8970a62b0194eaf836b8ee52732a27e`。
- 助手正文展示、`agent_settled`、SQLite 保存，以及 reload 后从侧栏恢复均通过。

此结果证明该网关与模型的本次真实请求成功，不代表对其他供应商或全部模型的兼容性验收。凭证由主进程读取并在临时 profile 中通过 safeStorage 加密保存，清理时删除；没有写入源码、日志、截图或报告。

真实请求的报告保留在 `temp/agent-runtime-check/public-provider.json`，截图为 `public-provider.png`，后续本地验证不会覆盖。执行方式及显式公网开关见 [验证命令说明](../scripts/agentRuntime/README.md)。

## 后续范围

NSIS 安装/卸载、应用或系统整体崩溃、其他模型 API/供应商、扩展与 MCP、远程同步及其他工作台能力仍按 [迁移总方案](./DURABLE-MIGRATION.md) 验收。本次没有将 utility process 强制退出恢复等同于全部应用崩溃恢复，也没有将会话主链路通过等同于 P0–P5 全部完成。
