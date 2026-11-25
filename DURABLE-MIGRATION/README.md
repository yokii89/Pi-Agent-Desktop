# Durable 迁移文档

本目录集中存放 PiDesk 内置 Durable 的方案、接口设计、扩展适配和验证记录。

工作分支：`trans-to-durable`。当前已加入 P0 的独立运行时与验证入口，业务会话尚未切换。

## 文档索引

- [迁移总方案](./DURABLE-MIGRATION.md)：目标架构、现有功能对照、扩展适配、存储与旧历史、手机同步、分阶段实施及验收标准。
- [P0 Electron 验证记录](./P0-VERIFICATION.md)：依赖脚本策略、本机 Electron 恢复、utility process 与打包态 SQLite 实测结果。
- [验证命令说明](../scripts/agentRuntime/README.md)：`pnpm check:agent-runtime` 的执行方式、覆盖范围与报告位置。

## 已确认的迁移边界

- Durable 随 PiDesk 内置交付，新会话不再依赖外部 pi CLI 或 pi RPC。
- 前端布局与工作台整体保留，通过数据适配承接新的执行内核。
- 旧 pi JSONL 历史仅供查看，不续接为 Durable 会话。
- 扩展、MCP 与 View 能力逐项明确适配契约和验证结果。

后续接口设计、实施进度与验证记录统一补充到本目录，并更新文档索引。
