# P1 会话服务与投影基础

本文件保留 P1 内部会话服务和投影基础交付时的记录，其中“默认业务会话尚未切换”“投影尚未接入前端”等描述属于该阶段状态。当前桌面业务链路、ASAR 生产协议、utility process 故障结算与真实模型请求的最新结果见 [P1 桌面业务链路验收](./P1-DESKTOP-ACCEPTANCE.md)。

内部基础阶段没有新增依赖，也没有读取真实会话、模型凭证或相邻扩展仓库。

## 内部契约与生命周期

实现入口：

- [`DurableSessions`](../src/agentRuntime/durableSessions.ts)：一个服务持有多个顶层会话，每个会话独立 Harness / SQLite。
- [`DurableSessionUpdate`](../src/shared/durableSession.ts)：进程内观察契约，区分初次快照、已保存 entries、live 状态、真正收口与错误。它不是已经开放的 renderer / extension / remote 协议。
- [`DurableProjection`](../src/main/agentRuntime/durableProjection.ts)：单会话投影，产出已有文档流事件，以及必须由后续前端接入处理的 hydrate / reconcile / 自定义 entry 动作。

会话 ID 为宿主生成的 UUID，内部统一小写。路径只能由服务在受信任的 `storageRoot/<UUID>/session.sqlite` 下解析，调用者不能用任意路径充当会话 ID。当前验证注入临时存储根；正式 userData 目录与跨 IPC 的 `SessionRef` 在业务接入时确定，尚未改变既有历史列表的文件引用。

同 ID 并发打开共享同一个 Harness。进程内的数据库写者登记按真实路径判重，Windows 上再忽略路径大小写；它不提供跨进程文件锁。正式运行仍必须由一个应用级 utility process 统一持有数据库，不得再启动第二个写者。

打开时只对首次创建的 root 应用 agent 初值；重开核对已保存 cwd，并由运行时调用 `resume()`。模型、thinking 与工具选择通过 `configure()` 持久化，cwd 不允许借此改写。Models / Registry 由受信任的运行时工厂注入，没有在这个服务里加载旧 CLI、凭证文件或旧扩展。

支持 input / continue / write admission、submission 状态读取、单项队列撤回、前台中断、手动压缩 admission 和历史分页。`requestId` 的幂等由 Durable 存储维护，关闭重开后仍有效。单项撤回通过绑定 conversation 的 `abortSubmission()` 完成，不会误中断当前回答。

关闭先拒绝新 admission，再等待已经进入的调用、停止 watch、排空投影扫描，最后关闭 Harness、刷新 SQLite 并释放写者登记。`dispose()` 拒绝后续打开。关闭与用户中断是不同操作，关闭不先调用 abort，已经保存的睡眠任务能在重开后继续。关闭失败保留写者登记，避免把尚未关闭的库交给第二个 Harness。

## 历史与完成边界

初次 watch 产出 snapshot，不把已有 entries 当新消息重放。watch 的滑动窗口不是完整历史；后续视图前进时，服务按 entry ID 范围分页读取缺失的已保存条目，每页最多 100 条，再发布 entries。不能通过 ID 差值推断记录数量。

watch 和收口时的补齐扫描使用同一串行队列，避免重复完成事件。live 文档与已保存 entries 分开发布：live 可能包含 deferred persistence 的 partial，不能给手机或历史服务当作保存凭证。

收口等待 conversation 的 `waitForIdle()`，包含其普通所有权范围内的子工作。不会把 `Submission.wait()` / 回答已经保存当作所有 `afterRun` 任务都完成。新 admission 或关闭会废止过期的收口观察；被拒绝的 busy admission 也不会丢失当前 run 的观察。

## 已实现的投影与接入限制

- 初次附着 / 重连使用 hydrate 替换视图，不补发旧正文 delta。
- text / thinking 仅在前缀一致时转换为现有 `message_update.assistantMessageEvent`。
- partial 内容被替换、工具参数对象变化或 attempt 改变时，产出显式 reconcile；不会把新内容继续拼到旧 partial 上。
- 已保存 assistant entry 产出一次权威 `message_end`，用 entry 游标去重，避免重复累计 usage。
- 快速结束的顶层工具可以从 assistant tool call 与 tool-result entries 重建 start / end，保留参数、内容、details、嵌套调用记录、错误和耗时。
- queue_update 使用插话 / 稍后队列的全量快照。只有服务给出 settled 才投影 `agent_settled`。
- 自定义 entry / compaction / reset 不冒充用户消息，保留为独立 entry 动作；错误也保留显式动作。

**投影目前没有接入 session IPC 或 React store。** hydrate / reconcile / entry 动作的前端消费、嵌套工具的完整生命周期、压缩及重试状态提示、run failure 的界面映射仍需 P1 后续实现。现有前端 32ms 合批链路尚未改接，不能据此宣布文档流已完成 Durable 迁移。

本轮的实际 utility process 通过现有 smoke-test 入口执行这套会话服务；生产业务的 open / submit 等 MessagePort 请求尚未开放。内部 smoke 协议升级为 v2，改为传受控临时存储根，主进程与 runtime 同步更新，避免把 UUID 会话库继续伪装成指定 JSONL / SQLite 文件路径。

## 验证记录

- `pnpm typecheck`：主进程、ESM runtime 与前端类型检查通过。
- `pnpm exec vitest run --config src/main/vitest.config.ts agentRuntime`：3 个测试文件、17 项测试全部通过，覆盖会话生命周期、SQLite、投影与内部协议。
- `pnpm test:agent-runtime`：系统 Node 中执行实际会话服务，完成工具调用、并发打开、重复 admission、保存结果去重、关闭重开及无重放水合。
- `pnpm check:agent-runtime`：同一场景在 Electron 41.0.3 utility process（Node 24.14.0）和独立临时目录中的 `win-unpacked` / `app.asar` 均通过。沿用空环境变量与独立 profile，没有外部 pi CLI / Node 执行路径或真实模型请求。

SQLite 测试还覆盖超过 watch 窗口的 235 条记录补齐、`afterRun` 回答完成后仍 busy、睡眠任务关闭重开恢复、关闭期间待完成的打开 / 写入、多会话隔离和持久 cwd 核对。没有把正常关闭重开测试当成进程强杀恢复验证。

NSIS 安装 / 卸载、进程强杀恢复、真实模型凭证、图片资源、完整桌面交互和手机同步仍未验收。

## 下一实施块

先固定正式 `SessionRef`、userData 路径与生产 MessagePort 请求 / 推送 DTO，接通宿主持有的模型目录和凭证服务；再为 React store 接入 hydrate / reconcile 与历史分页，补齐嵌套工具、重试 / 压缩 / 失败状态。上述路径端到端验证后，才切换新会话入口并继续 P2 的旧历史只读与应用服务迁移。
