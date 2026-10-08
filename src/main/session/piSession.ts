import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
import type {
  PiAgentEvent,
  PiImageContent,
  SessionId,
  SessionPushMessage,
  SessionStartRequest,
} from "../../shared/ipc";
import { SESSION_IPC } from "../../shared/ipc";
import { procService } from "../proc/procService";
import { getSettings } from "../settings/settings";
import {
  closeSessionViews,
  ensureViewHost,
  getViewHostRendezvousPath,
  retainSessionViews,
} from "../view/viewHost";
import { getMainWindow } from "../window/createMainWindow";
import { resolvePiCommand } from "./piLauncher";
import { readDefaultModel } from "./piSettings";
import {
  getRuntimeState,
  markRuntimeActivity,
  markRuntimeExit,
  markRuntimeUsedByUser,
  noteRuntimeSessionFile,
  noteSessionSpawned,
} from "./runtimeCoordinator";
import { clearSessionCwd, noteSessionCwd } from "./sessionCwdRegistry";
import {
  normalizeMaxParallelSessions,
  type SessionInstanceSnapshot,
  SessionRegistry,
} from "./sessionRegistry";

/** 转发给渲染层的 pi 事件白名单：其余事件（queue_update 等）渲染层暂不需要。 */
const FORWARD_EVENT_TYPES = new Set<string>([
  "agent_start",
  "agent_end",
  "agent_settled",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "auto_retry_start",
  "auto_retry_end",
  "compaction_start",
  "compaction_end",
]);

/**
 * 高频流式事件进帧合批（约 32ms）；边界事件立即 flush + 单条下发，
 * 避免状态机依赖被延迟到下一帧。
 */
const BATCHABLE_EVENT_TYPES = new Set<string>(["message_update", "tool_execution_update"]);

/** 高频流式事件合批窗口（ms）。 */
const EVENT_BATCH_MS = 32;

/** pi bash 工具名（后台进程快照边界）。 */
function isBashTool(toolName: string | undefined): boolean {
  return toolName === "bash" || toolName === "shell";
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

interface SessionInstance extends SessionInstanceSnapshot {
  child: ChildProcessWithoutNullStreams | null;
  /** 同 id 重启 ++，用于 exit 回调过滤过期子进程。 */
  generation: number;
  nextRequestId: number;
  pendingRequests: Map<number, PendingRequest>;
  eventBatch: PiAgentEvent[];
  eventBatchTimer: ReturnType<typeof setTimeout> | null;
  cwd: string;
}

const registry = new SessionRegistry();
/** 运行时实例：Map key 为 SessionId（≠ SessionSummary.id）。 */
const instances = new Map<SessionId, SessionInstance>();

function createSessionId(): SessionId {
  return `sess_${randomUUID()}`;
}

function push(sessionId: SessionId, message: Omit<SessionPushMessage, "sessionId">): void {
  getMainWindow()?.webContents.send(SESSION_IPC.output, {
    ...message,
    sessionId,
  } as SessionPushMessage);
}

function flushEventBatch(inst: SessionInstance): void {
  if (inst.eventBatchTimer !== null) {
    clearTimeout(inst.eventBatchTimer);
    inst.eventBatchTimer = null;
  }
  if (inst.eventBatch.length === 0) return;
  const events = inst.eventBatch;
  inst.eventBatch = [];
  push(inst.id, { type: "eventBatch", payload: events });
}

/** 高频流式事件入批；边界事件先 flush 再单条下发。 */
function pushAgentEvent(inst: SessionInstance, event: PiAgentEvent): void {
  if (BATCHABLE_EVENT_TYPES.has(event.type)) {
    inst.eventBatch.push(event);
    if (inst.eventBatchTimer === null) {
      inst.eventBatchTimer = setTimeout(() => {
        inst.eventBatchTimer = null;
        flushEventBatch(inst);
      }, EVENT_BATCH_MS);
    }
    return;
  }
  flushEventBatch(inst);
  push(inst.id, { type: "event", payload: event });
}

function syncRegistrySnapshot(inst: SessionInstance): void {
  registry.upsert({
    id: inst.id,
    sessionFile: inst.sessionFile,
    childAlive: inst.child !== null && !inst.shuttingDown,
    shuttingDown: inst.shuttingDown,
  });
}

function getLiveInstance(id: SessionId): SessionInstance | null {
  const inst = instances.get(id);
  if (!inst?.child || inst.shuttingDown) return null;
  return inst;
}

/** 指定 sessionId 是否有存活 pi RPC 进程。 */
export function hasSession(id: SessionId): boolean {
  return getLiveInstance(id) !== null;
}

/** 当前存活实例 id 列表（调试 / 对账 / 默认模型广播）。 */
export function listLiveSessions(): SessionId[] {
  return [...instances.values()]
    .filter((i) => i.child !== null && !i.shuttingDown)
    .map((i) => i.id);
}

function maxParallelSessions(): number {
  return normalizeMaxParallelSessions(getSettings().maxParallelSessions);
}

function buildInstance(id: SessionId, cwd: string, sessionFile: string | null): SessionInstance {
  return {
    id,
    sessionFile,
    childAlive: false,
    shuttingDown: false,
    child: null,
    generation: 0,
    nextRequestId: 0,
    pendingRequests: new Map(),
    eventBatch: [],
    eventBatchTimer: null,
    cwd,
  };
}

function bindInstanceIO(inst: SessionInstance, child: ChildProcessWithoutNullStreams): void {
  const generation = inst.generation;
  /** 过期子进程（restart/dispose 后）的数据不得再写入当前实例。 */
  const stale = (): boolean => inst.generation !== generation || inst.child !== child;

  // stdin 按请求写入；stdout 用 StringDecoder + 手动 LF 分割，
  // 不能用 readline：它还会按 U+2028/U+2029 分行，而合法 JSON 字符串里允许这些码点
  const decoder = new StringDecoder("utf8");
  let lineBuffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    if (stale()) return;
    lineBuffer += decoder.write(chunk);
    let newlineAt = lineBuffer.indexOf("\n");
    while (newlineAt !== -1) {
      handleProtocolLine(inst, lineBuffer.slice(0, newlineAt).replace(/\r$/, ""));
      lineBuffer = lineBuffer.slice(newlineAt + 1);
      newlineAt = lineBuffer.indexOf("\n");
    }
  });
  child.stdout.on("end", () => {
    if (stale()) return;
    handleProtocolLine(inst, lineBuffer.replace(/\r$/, ""));
  });

  const stderrDecoder = new StringDecoder("utf8");
  let stderrBuffer = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (stale()) return;
    stderrBuffer += stderrDecoder.write(chunk);
    let newlineAt = stderrBuffer.indexOf("\n");
    while (newlineAt !== -1) {
      const line = stderrBuffer.slice(0, newlineAt).trim();
      if (line) push(inst.id, { type: "error", payload: line.slice(0, 2000) });
      stderrBuffer = stderrBuffer.slice(newlineAt + 1);
      newlineAt = stderrBuffer.indexOf("\n");
    }
  });

  child.on("exit", (code) => {
    // 仅当仍是当前实例的当前代次子进程才清理 pending / 推 exit
    if (stale()) return;
    inst.child = null;
    inst.shuttingDown = false;
    inst.childAlive = false;
    flushEventBatch(inst);
    for (const pending of inst.pendingRequests.values()) {
      pending.reject(new Error("pi 进程已退出"));
    }
    inst.pendingRequests.clear();
    // pi 退出 → 旁路对端关闭；只回收该会话名下打开中的视图
    closeSessionViews(inst.id);
    registry.remove(inst.id);
    // 实例对象保留与否：exit 后进程已死，移除 Map 以便同 file 冷启动新 id
    instances.delete(inst.id);
    markRuntimeExit(inst.id);
    clearSessionCwd(inst.id);
    push(inst.id, { type: "exit", payload: code ?? -1 });
  });
  child.on("error", (error) => {
    if (inst.child !== child || inst.generation !== generation) return;
    push(inst.id, { type: "error", payload: `pi 进程异常：${error.message}` });
  });
}

async function spawnInstance(
  sessionId: SessionId,
  req: SessionStartRequest,
): Promise<SessionInstance> {
  const cwd = req.cwd && fs.existsSync(req.cwd) ? req.cwd : os.homedir();
  const sessionFile = req.sessionFile ?? null;
  const { file, args } = resolvePiCommand(getSettings().piExecutablePath);
  args.push("--mode", "rpc");
  if (sessionFile) {
    args.push("--session", sessionFile);
  }

  // View Host 失败不阻塞会话：扩展 SDK 探测不到 env 时回落 TUI/对话框
  let viewEnv: Awaited<ReturnType<typeof ensureViewHost>> | null = null;
  try {
    viewEnv = await ensureViewHost();
  } catch {
    viewEnv = null;
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (viewEnv) {
    // 双前缀（docs/design/08 §12）：PIDESK_VIEW_* 为主，PI_VIEW_* 同值别名供其它宿主复用
    env.PIDESK_VIEW_ENDPOINT = viewEnv.endpoint;
    env.PIDESK_VIEW_TOKEN = viewEnv.token;
    env.PIDESK_VIEW_PROTOCOL = viewEnv.protocol;
    env.PIDESK_VIEW_SESSION = sessionId;
    env.PI_VIEW_ENDPOINT = viewEnv.endpoint;
    env.PI_VIEW_TOKEN = viewEnv.token;
    env.PI_VIEW_PROTOCOL = viewEnv.protocol;
    env.PI_VIEW_SESSION = sessionId;
    // 稳定 rendezvous（docs/design/15 P0-1）：Host 重启后 SDK 从该文件刷新 endpoint/token
    const rendezvous = viewEnv.rendezvousPath ?? getViewHostRendezvousPath();
    env.PIDESK_VIEW_RENDEZVOUS = rendezvous;
    env.PI_VIEW_RENDEZVOUS = rendezvous;
  }

  // Contribution key 映射（docs/design/16）：access-mode / panel / settings 都要透传，
  // 否则 Telegram 等 panel 扩展拿不到 key，Catalog 冷态绑定会失败。
  try {
    const { getCatalogSnapshot } = await import("../extension/contributionCatalog");
    const catalog = getCatalogSnapshot(cwd);
    const keyById: Record<string, string> = {};
    const ambiguous = new Set<string>();
    for (const entry of catalog.entries) {
      if (ambiguous.has(entry.id)) continue;
      if (keyById[entry.id] && keyById[entry.id] !== entry.key) {
        delete keyById[entry.id];
        ambiguous.add(entry.id);
        continue;
      }
      keyById[entry.id] = entry.key;
    }
    if (Object.keys(keyById).length > 0) {
      const encoded = JSON.stringify(keyById);
      env.PIDESK_VIEW_CONTRIBUTION_KEYS = encoded;
      env.PI_VIEW_CONTRIBUTION_KEYS = encoded;
    }
  } catch {
    // Catalog 扫描失败不阻塞会话
  }

  const existing = instances.get(sessionId);
  // 并发同 id start 的兜底（TOCTOU 防护只覆盖带 sessionFile 的请求）：
  // 两次 start 都过了 decideStart 后，第二个 spawnInstance 会 generation++ 把
  // 第一个 child 顶成无人写入也无人 kill 的孤儿——发现存活实例直接收编返回
  if (existing?.child && !existing.shuttingDown) {
    return existing;
  }
  const inst = existing ?? buildInstance(sessionId, cwd, sessionFile);
  inst.cwd = cwd;
  inst.sessionFile = sessionFile;
  inst.shuttingDown = false;
  inst.generation += 1;
  inst.childAlive = true;
  instances.set(sessionId, inst);
  syncRegistrySnapshot(inst);

  const child = spawn(file, args, { cwd, env, windowsHide: true });
  inst.child = child;
  noteSessionCwd(sessionId, cwd);
  noteSessionSpawned({
    sessionId,
    sessionFile,
    cwd,
    reason: req.reason ?? "manual",
  });
  bindInstanceIO(inst, child);
  syncRegistrySnapshot(inst);
  return inst;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 把 settings 的 defaultProvider/defaultModel 写入目标会话（RPC set_model）。
 * target 为 "all" 时广播到所有存活实例。
 * 返回是否至少有一个目标成功对齐；失败按退避重试，覆盖冷启动模型表未就绪、
 * 以及 `--session` 恢复把旧 model_change 写回这两种竞态。
 */
export async function applyDefaultModelToSession(
  target: SessionId | "all" = "all",
  options?: { retries?: number; delayMs?: number },
): Promise<boolean> {
  const retries = options?.retries ?? 3;
  const delayMs = options?.delayMs ?? 300;
  const { provider, modelId } = readDefaultModel();
  if (!provider || !modelId) return false;

  const ids = target === "all" ? listLiveSessions() : hasSession(target) ? [target] : [];
  if (ids.length === 0) return false;

  let anyOk = false;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const live = ids.filter((id) => hasSession(id));
    if (live.length === 0) return anyOk;
    const results = await Promise.all(
      live.map(async (id) => {
        try {
          await setSessionModel(id, provider, modelId);
          return true;
        } catch {
          return false;
        }
      }),
    );
    if (results.some(Boolean)) {
      anyOk = true;
      if (results.every(Boolean)) return true;
    }
    if (attempt === retries) return anyOk;
    await sleep(delayMs * (attempt + 1));
  }
  return anyOk;
}

/**
 * 启动 pi RPC 会话（多实例并行，docs/多会话并行架构方案）。
 * - 同 sessionFile 存活实例：返回既有 SessionId，不 spawn 第二个（决策 #4）
 * - 同 sessionId 再 start：先 dispose 该实例再 spawn（generation++）
 * - 超过 maxParallelSessions：失败，不自动杀最旧
 * stdout 为严格 JSONL（仅 LF 分隔）。
 */
const startsById = new Map<SessionId, Promise<SessionId>>();
const disposalPromises = new Map<SessionId, Promise<void>>();

/** 预热回收后等待实际退出再使用名额，不提前释放同 file 写入锁。 */
export async function waitForSessionDisposal(sessionId: SessionId): Promise<void> {
  await disposalPromises.get(sessionId);
}

export function startSession(req: SessionStartRequest): Promise<SessionId> {
  const id = req.sessionId;
  if (!id) return startSessionOnce(req);
  const existing = startsById.get(id);
  if (existing) return existing;
  const pending = startSessionOnce(req).finally(() => startsById.delete(id));
  startsById.set(id, pending);
  return pending;
}

async function startSessionOnce(req: SessionStartRequest): Promise<SessionId> {
  const max = maxParallelSessions();
  const sessionFile = req.sessionFile;

  // TOCTOU：同 file 在途 start 直接挂同一 Promise
  if (sessionFile) {
    const inflight = registry.fileStartInflight(sessionFile);
    if (inflight) return inflight;
  }

  const runStart = async (): Promise<SessionId> => {
    // 判定前再查一次（inflight 已 settle / 其它路径可能已写入）
    const decision = registry.decideStart(req, createSessionId, max);

    if (decision.kind === "reuse") {
      // 同 file 复用：可选回填 sessionId 请求（渲染层预生成 id 与既有不同时以既有为准）
      return decision.sessionId;
    }
    if (decision.kind === "reject" || decision.kind === "reject-limit") {
      throw new Error(decision.error);
    }

    const sessionId = decision.sessionId;
    if (decision.kind === "restart") {
      disposeSession(sessionId);
    }

    // 在第一次 await 前预留额度，避免不同冷会话并发启动突破上限。
    registry.upsert({
      id: sessionId,
      sessionFile: sessionFile ?? null,
      childAlive: false,
      shuttingDown: false,
    });
    return spawnInstance(sessionId, req)
      .then((inst) => {
        // 清理主进程 Map 中已不存在的孤儿会话视图，保证 Host 视图 sessionId ⊆ 存活实例
        retainSessionViews(new Set(listLiveSessions()));
        return inst.id;
      })
      .catch((error: unknown) => {
        if (!hasSession(sessionId)) registry.remove(sessionId);
        throw error;
      });
  };

  if (sessionFile) {
    return registry.beginFileStart(sessionFile, runStart);
  }
  return runStart();
}

/** 处理一行 pi 协议输出：事件（白名单转发）或请求响应（按 id 关联）。 */
function handleProtocolLine(inst: SessionInstance, line: string): void {
  if (!line.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;
  const record = parsed as { type?: unknown; id?: unknown };

  if (record.type === "response") {
    const id = typeof record.id === "number" ? record.id : -1;
    const pending = inst.pendingRequests.get(id);
    if (!pending) return;
    inst.pendingRequests.delete(id);
    const body = parsed as { success?: unknown; data?: unknown; error?: unknown };
    if (body.success === true) {
      pending.resolve(body.data);
    } else {
      pending.reject(new Error(typeof body.error === "string" ? body.error : "pi 请求失败"));
    }
    return;
  }

  if (typeof record.type === "string" && FORWARD_EVENT_TYPES.has(record.type)) {
    const agentEvent = parsed as PiAgentEvent;
    if (agentEvent.type === "agent_start") {
      markRuntimeActivity(inst.id, "busy");
    } else if (agentEvent.type === "agent_end" || agentEvent.type === "agent_settled") {
      // willRetry 的 agent_end 不是真空闲（自动重试/压缩续跑），meta 透传给旁路监听
      markRuntimeActivity(
        inst.id,
        "idle",
        agentEvent.type === "agent_end" && agentEvent.willRetry === true
          ? { willRetry: true }
          : undefined,
      );
    }
    // 后台进程监控（docs/design/37）：只读旁路，不改 push 格式
    if (agentEvent.type === "tool_execution_start" && isBashTool(agentEvent.toolName)) {
      const rootPid = inst.child?.pid;
      if (typeof rootPid === "number") {
        procService.noteBashStart(inst.id, rootPid, agentEvent.toolCallId);
      }
    } else if (agentEvent.type === "tool_execution_end") {
      // toolName 在 end 事件里可缺省：一律按 toolCallId 收口 pending bash（无则 no-op）
      procService.noteBashEnd(inst.id, agentEvent.toolCallId);
    }
    pushAgentEvent(inst, agentEvent);
  }
}

/** 向指定会话发送 RPC 请求并等待响应。 */
function request(
  sessionId: SessionId,
  command: string,
  fields: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<unknown> {
  const inst = getLiveInstance(sessionId);
  if (!inst?.child) {
    return Promise.reject(new Error("pi 会话未启动"));
  }
  const id = ++inst.nextRequestId;
  return new Promise<unknown>((resolve, reject) => {
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            inst.pendingRequests.delete(id);
            reject(new Error(`${command} 请求超时`));
          }, timeoutMs);
    inst.pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    try {
      inst.child?.stdin.write(`${JSON.stringify({ type: command, ...fields, id })}\n`);
    } catch (error) {
      clearTimeout(timer);
      inst.pendingRequests.delete(id);
      reject(error instanceof Error ? error : new Error("写入 pi stdin 失败"));
    }
  });
}

/**
 * 提交用户输入（RPC prompt；"/" 技能与模板由 pi 自动展开）。
 * `images` 对齐 rpc.md 的 `ImageContent[]`，随 prompt 一并进入 user content。
 * `timeoutMs` 可选：超时未收到 pi 接受响应则 reject（调度器等无人值守路径用它，
 * 防止挂起的 pi 永久占住派发状态）；用户输入路径不传，保持无限等待。
 */
export function promptSession(
  sessionId: SessionId,
  text: string,
  images?: PiImageContent[],
  timeoutMs?: number,
): Promise<void> {
  markRuntimeUsedByUser(sessionId);
  const fields: { message: string; images?: PiImageContent[] } = { message: text };
  if (images && images.length > 0) fields.images = images;
  return request(sessionId, "prompt", fields, timeoutMs).then(() => undefined);
}

/** 中断当前执行（RPC abort；pi 会在空闲后应答）。 */
export function interruptSession(sessionId: SessionId): void {
  request(sessionId, "abort").catch(() => {});
}

/** 读取当前会话消息（RPC get_messages，恢复历史会话用）。 */
export async function fetchSessionMessages(sessionId: SessionId): Promise<unknown[]> {
  const data = await request(sessionId, "get_messages");
  // pi 实际返回 { messages: [...] } 包装对象；兼容裸数组以防协议回退
  if (Array.isArray(data)) return data;
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { messages?: unknown }).messages)
  ) {
    return (data as { messages: unknown[] }).messages;
  }
  return [];
}

/** 读取 pi 可用斜杠命令（RPC get_commands）。 */
export function fetchSlashCommands(sessionId: SessionId): Promise<unknown> {
  return request(sessionId, "get_commands");
}

/** 设置思考档位（RPC set_thinking_level）。 */
export function setThinkingLevel(sessionId: SessionId, level: string): Promise<void> {
  return request(sessionId, "set_thinking_level", { level }).then(() => undefined);
}

/** 读取会话状态（模型 / 思考档位等）。 */
export async function fetchSessionState(
  sessionId: SessionId,
  timeoutMs?: number,
): Promise<unknown> {
  const state = await request(sessionId, "get_state", {}, timeoutMs);
  const file =
    state && typeof state === "object"
      ? (state as { sessionFile?: unknown }).sessionFile
      : undefined;
  if (typeof file === "string" && file) {
    const inst = instances.get(sessionId);
    if (inst) {
      inst.sessionFile = file;
      registry.patch(sessionId, { sessionFile: file });
      noteRuntimeSessionFile(sessionId, file);
    }
  }
  return state;
}

/** 读取会话用量统计（RPC get_session_stats，含 contextUsage）。 */
export function fetchSessionStats(sessionId: SessionId, timeoutMs?: number): Promise<unknown> {
  return request(sessionId, "get_session_stats", {}, timeoutMs);
}

/** 切换模型（RPC set_model）。 */
export function setSessionModel(
  sessionId: SessionId,
  provider: string,
  modelId: string,
): Promise<unknown> {
  return request(sessionId, "set_model", { provider, modelId });
}

/** 读取可用模型列表（RPC get_available_models）。 */
export function fetchAvailableModels(sessionId: SessionId): Promise<unknown> {
  return request(sessionId, "get_available_models");
}

/**
 * 重载会话配置（docs/design/39）：RPC switch_session 切回当前会话文件，
 * 触发 session_shutdown → session_start，MCP 扩展在 session_start 重读 mcp.json；
 * 对话历史保留。尚未落盘的空会话改发 new_session（同样触发 session_start 且无内容可丢）。
 * 忙碌中拒绝（switch 与运行中的 agent 竞争），由 UI 引导稍后重试。
 */
export async function reloadSessionConfig(sessionId: SessionId): Promise<{ switched: boolean }> {
  const runtimeState = getRuntimeState(sessionId);
  if (runtimeState === "busy" || runtimeState === "starting") {
    throw new Error("会话正在运行，请等待空闲后重试");
  }
  const state = await fetchSessionState(sessionId, 10_000);
  const file =
    state && typeof state === "object"
      ? (state as { sessionFile?: unknown }).sessionFile
      : undefined;
  if (typeof file !== "string" || !file) {
    // 尚未落盘（还没发过首条消息）：进程启动时的 session_start 已读过旧配置，
    // 等下去只会带着旧工具集；直接开新会话触发 session_start 重读 mcp.json——
    // 空对话没有内容可丢，对用户零影响。
    await request(sessionId, "new_session", {}, 15_000);
    return { switched: true };
  }
  const data = await request(sessionId, "switch_session", { sessionPath: file }, 15_000);
  const cancelled =
    data && typeof data === "object" && (data as { cancelled?: unknown }).cancelled === true;
  if (cancelled) {
    throw new Error("会话重载被扩展取消");
  }
  return { switched: true };
}

/**
 * 结束指定会话的 pi 进程：先关 stdin（pi 约定为干净退出），超时兜底 kill。
 * 只影响该实例的 pending 与视图；历史 JSONL 保留。
 */
export function disposeSession(sessionId: SessionId): void {
  const inst = instances.get(sessionId);
  if (!inst) {
    registry.remove(sessionId);
    return;
  }
  const child = inst.child;
  if (inst.shuttingDown) return;
  inst.child = null;
  inst.childAlive = false;
  inst.shuttingDown = true;
  syncRegistrySnapshot(inst);
  flushEventBatch(inst);
  closeSessionViews(sessionId);
  // 后台进程登记保留（有意留下的服务）；只取消未决 bash 快照窗口
  procService.noteSessionDisposed(sessionId);
  for (const pending of inst.pendingRequests.values()) {
    pending.reject(new Error("pi 会话已结束"));
  }
  inst.pendingRequests.clear();
  // 显式 dispose 也推 exit，渲染层桶状态与「进程已不在」对齐（B5）
  markRuntimeExit(sessionId);
  clearSessionCwd(sessionId);
  push(sessionId, { type: "exit", payload: 0 });
  if (!child) {
    registry.remove(sessionId);
    instances.delete(sessionId);
    return;
  }
  const disposed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  disposalPromises.set(sessionId, disposed);
  void disposed.finally(() => disposalPromises.delete(sessionId));
  try {
    child.stdin.end();
  } catch {
    // 进程已退出时忽略
  }
  const killTimer = setTimeout(() => {
    try {
      child.kill();
    } catch {
      // 已退出时忽略
    }
  }, 3000);
  child.once("exit", () => {
    clearTimeout(killTimer);
    if (instances.get(sessionId)?.child === null) {
      registry.remove(sessionId);
      instances.delete(sessionId);
    }
  });
}

/** 应用退出：遍历全部实例 dispose，各 3s kill 兜底（will-quit）。 */
export function disposeAllSessions(): void {
  for (const id of [...instances.keys()]) {
    disposeSession(id);
  }
  closeSessionViews("all");
  registry.clear();
}
