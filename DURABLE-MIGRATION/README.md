# Durable 迁移文档

本目录集中存放 PiDesk 内置 Durable 的方案、接口设计、扩展适配和验证记录。

当前工作分支：`feat/durable-desktop-integration`。P0 的独立运行时、P1 的默认业务会话与投影、P2 的历史和应用服务已接通；P3A 原生扩展/提示命令与 P3B 技能/模板/项目指令已通过开发态及 ASAR 验收。P3 的 View、设置作用域宿主与持久交互，以及后续 MCP、常用扩展和远程清理仍按总方案推进。

## 文档索引

- [迁移总方案](./DURABLE-MIGRATION.md)：目标架构、现有功能对照、扩展适配、存储与旧历史、手机同步、分阶段实施及验收标准。
- [P0 Electron 验证记录](./P0-VERIFICATION.md)：依赖脚本策略、本机 Electron 恢复、utility process 与打包态 SQLite 实测结果。
- [P1 会话服务与投影基础](./P1-SESSION-FOUNDATION.md)：内部基础阶段的契约、SQLite 写者与生命周期、历史补齐和完成边界。
- [P1 桌面业务链路验收](./P1-DESKTOP-ACCEPTANCE.md)：实际 Electron 与 ASAR 中的创建发送、历史恢复、进程异常结算，以及公网模型请求结果。
- [P3A 原生扩展宿主](./P3-EXTENSION-HOST.md)：内部预览清单、会话作用域、Registry 与提示命令生命周期。
- [P3B 技能、模板与项目指令](./P3-RESOURCES.md)：资源发现与启停、命令展开、AGENTS.md 恢复前刷新及实际工作台/ASAR 验证。
- [验证命令说明](../scripts/agentRuntime/README.md)：`pnpm check:agent-runtime` 的执行方式、覆盖范围与报告位置。

## 已确认的迁移边界

- Durable 随 PiDesk 内置交付，新会话不再依赖外部 pi CLI 或 pi RPC。
- 前端布局与工作台整体保留，通过数据适配承接新的执行内核。
- 旧 pi JSONL 历史仅供查看，不续接为 Durable 会话。
- 扩展、MCP 与 View 能力逐项明确适配契约和验证结果。

后续接口设计、实施进度与验证记录统一补充到本目录，并更新文档索引。
