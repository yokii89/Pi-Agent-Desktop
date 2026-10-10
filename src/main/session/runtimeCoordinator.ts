/**
 * Session Runtime Coordinator（docs/design/16 §8、§6.1）。
 * 包装 piSession.startSession：ready barrier、启动原因、runtime 快照、结构化超限错误。
 * 不重写 JSONL/RPC 传输层。
 */

import type {
  SessionId,
  SessionLimitReachedError,
  SessionRuntimeErrorCode,
  SessionRuntimeSnapshot,
  SessionRuntimeState,
  SessionStartReason,
} from "../../shared/contribution";
import { RUNTIME_IPC, RUNTIME_READY_TIMEOUT_MS } from "../../shared/contribution";
import type { SessionStartRequest } from "../../shared/ipc";
import { getCatalogSnapshot } from "../extension/contributionCatalog";
import { getMainWindow } from "../window/createMainWindow";
import {
  disposeSession,
  fetchSessionState,
  hasSession,
  startSession,
  waitForSessionDisposal,
} from "./piSession";
import {
  canReclaimSpeculative,
  canSupersedeSpeculative,
  isSpeculativeCreatedBy,
} from "./speculativeReclaim";

export interface CoordinatorStartRequest extends SessionStartRequest {
  reason?: SessionStartReason;
}

export interface RuntimeRecord {
  sessionId: SessionId;
  sessionFile: string | null;
  cwd: string | null;
  state: SessionRuntimeState;
  reason: SessionStartReason | null;
  createdBy: SessionStartReason | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  extensionFingerprint: string | null;
  /** 显式用户使用过（send/view-action/manual）；speculative 只有 false 时可回收。 */
  usedByUser: boolean;
  errorCode?: SessionRuntimeErrorCode;
  errorMessage?: string;
  /** ready barrier 的 inflight Promise（同 id 合流）。 */
  readyPromise: Promise<void> | null;
}

const records = new Map<SessionId, RuntimeRecord>();
/** 激活/启动互斥：sessionId + contributionKey，同 key 合并重复点击。 */
const activationLocks = new Map<string, Promise<unknown>>();

/** Phase G：预热与 ready 延迟统计（内存，不落盘）。 */
export const prefetchStats = {
  attempts: 0,
  skippedLimit: 0,
  reclaimed: 0,
  /** view-action → ready 延迟样本（ms）。 */
  readySamples: [] as number[],
  /** send → ready 延迟样本（ms，docs/design/44 A4）。 */
  sendSamples: [] as number[],
  /** 显式启动时实例已 ready（命中）/ 未 ready（含在途预热）的次数。 */
  hits: 0,
  misses: 0,
};

const MAX_READY_SAMPLES = 50;

function pushSample(samples: number[], ms: number): void {
  samples.push(ms);
  if (samples.length > MAX_READY_SAMPLES) {
    samples.splice(0, samples.length - MAX_READY_SAMPLES);
  }
}

export function recordReadyLatency(ms: number): void {
  pushSample(prefetchStats.readySamples, ms);
}

/** 发送路径 ready 延迟：发送时未 ready 的真实等待（docs/design/44 A4）。 */
export function recordSendLatency(ms: number): void {
  pushSample(prefetchStats.sendSamples, ms);
}

function isReadyState(state: SessionRuntimeState): boolean {
  return state === "ready" || state === "idle" || state === "busy";
}

/** 实例当前是否可用（ready/idle/busy）——渲染层直通 prompt 的命中判定用。 */
export function isRuntimeReady(sessionId: SessionId): boolean {
  return isReadyState(getRuntimeState(sessionId));
}

/**
 * 渲染层直通 prompt 的命中记账：热实例路径不经 ensureSessionReady，
 * 由 prompt IPC 入口判定后调用（docs/design/44 A4：send 延迟样本 + 命中计数）。
 */
export function noteWarmPrompt(startedAtMs: number): void {
  prefetchStats.hits += 1;
  recordSendLatency(Math.max(0, Date.now() - startedAtMs));
}

function lockKey(sessionId: SessionId, contributionKey: string): string {
  return `${sessionId}::${contributionKey}`;
}

/**
 * 未晋升的新会话预热实例对渲染层不可见（docs/design/44 A2）：
 * 渲染层没有对应桶，推送只会经 ensureBucket 造出幽灵桶并回流"计划 sessionFile"；
 * 晋升（promote 改写 createdBy）后恢复正常推送。
 */
function isHiddenFromRenderer(rec: RuntimeRecord): boolean {
  return rec.createdBy === "new-chat-prefetch";
}

function pushRuntimeChanged(rec: RuntimeRecord): void {
  if (isHiddenFromRenderer(rec)) return;
  getMainWindow()?.webContents.send(RUNTIME_IPC.changed, toSnapshot(rec));
}

function isStale(fingerprint: string | null, cwd: string | null): boolean {
  if (!fingerprint) return false;
  try {
    const current = getCatalogSnapshot(cwd).fingerprint;
    return fingerprint !== current;
  } catch {
    return false;
  }
}

function toSnapshot(rec: RuntimeRecord): SessionRuntimeSnapshot {
  return {
    sessionId: rec.sessionId,
    sessionFile: rec.sessionFile,
    cwd: rec.cwd,
    state: rec.state,
    reason: rec.reason,
    createdBy: rec.createdBy,
    startedAt: rec.startedAt,
    lastActivityAt: rec.lastActivityAt,
    extensionFingerprint: rec.extensionFingerprint,
    staleExtension: rec.state !== "cold" && isStale(rec.extensionFingerprint, rec.cwd),
    errorCode: rec.errorCode,
    errorMessage: rec.errorMessage,
  };
}

function patchRecord(id: SessionId, patch: Partial<RuntimeRecord>): void {
  const rec = records.get(id);
  if (!rec) return;
  Object.assign(rec, patch);
  pushRuntimeChanged(rec);
}

function ensureRecord(
  id: SessionId,
  init: { sessionFile?: string | null; cwd?: string | null },
): RuntimeRecord {
  let rec = records.get(id);
  if (!rec) {
    rec = {
      sessionId: id,
      sessionFile: init.sessionFile ?? null,
      cwd: init.cwd ?? null,
      state: "cold",
      reason: null,
      createdBy: null,
      startedAt: null,
      lastActivityAt: null,
      extensionFingerprint: null,
      usedByUser: false,
      readyPromise: null,
    };
    records.set(id, rec);
  }
  if (init.sessionFile !== undefined) rec.sessionFile = init.sessionFile;
  if (init.cwd !== undefined) rec.cwd = init.cwd;
  return rec;
}

/** 标记会话进程退出/回收。 */
export function markRuntimeExit(sessionId: SessionId): void {
  const rec = records.get(sessionId);
  if (!rec) return;
  rec.state = "cold";
  rec.readyPromise = null;
  rec.lastActivityAt = Date.now();
  pushRuntimeChanged(rec);
  notifyActivityListeners(sessionId, "exit");
}

/**
 * 运行时活动旁路监听（busy / idle / exit）。
 * 调度器用它做冲突判定与运行台账的完成时刻回填，不侵入渲染层推送链路。
 * idle 附带 willRetry：自动重试的 agent_end 不是真空闲，回填方据此跳过。
 */
export type RuntimeActivityKind = "busy" | "idle" | "exit";
export type RuntimeActivityMeta = { willRetry?: boolean };
export type RuntimeActivityListener = (
  sessionId: SessionId,
  activity: RuntimeActivityKind,
  meta?: RuntimeActivityMeta,
) => void;

const activityListeners = new Set<RuntimeActivityListener>();

export function onRuntimeActivity(listener: RuntimeActivityListener): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

function notifyActivityListeners(
  sessionId: SessionId,
  activity: RuntimeActivityKind,
  meta?: RuntimeActivityMeta,
): void {
  for (const listener of activityListeners) {
    try {
      listener(sessionId, activity, meta);
    } catch {
      // 旁路监听失败不拖垮 runtime 状态机
    }
  }
}

/**
 * 单会话 runtime 状态（O(1) 查找，不做全量快照构建）。
 * 进程已死时返回 cold，避免调度器把死会话误判为忙。
 * 冲突判定等单会话场景用它，替代 listRuntimeSnapshots 的全量分配。
 */
export function getRuntimeState(sessionId: SessionId): SessionRuntimeState {
  const rec = records.get(sessionId);
  if (!rec) return "cold";
  if (rec.state !== "cold" && rec.state !== "failed" && !hasSession(sessionId)) {
    return "cold";
  }
  return rec.state;
}

/** 单会话已知的 JSONL 路径（无记录为 null）；派发台账回填用，避免全量快照查找。 */
export function getRuntimeSessionFile(sessionId: SessionId): string | null {
  return records.get(sessionId)?.sessionFile ?? null;
}

/** pi 返回的实际 JSONL 路径用于 reload 后绑定原运行时。 */
export function noteRuntimeSessionFile(sessionId: SessionId, sessionFile: string): void {
  patchRecord(sessionId, { sessionFile });
}

/** 标记 agent busy/idle（由 session 输出事件调用）。 */
export function markRuntimeActivity(
  sessionId: SessionId,
  activity: "busy" | "idle",
  meta?: { willRetry?: boolean },
): void {
  const rec = records.get(sessionId);
  if (!rec) return;
  if (rec.state === "cold" || rec.state === "stopping" || rec.state === "failed") return;
  rec.state = activity;
  rec.lastActivityAt = Date.now();
  pushRuntimeChanged(rec);
  notifyActivityListeners(sessionId, activity, meta);
}

/** 显式用户使用过该会话（prompt 等）：speculative 不可再自动回收。 */
export function markRuntimeUsedByUser(sessionId: SessionId): void {
  const rec = records.get(sessionId);
  if (!rec) return;
  rec.usedByUser = true;
  if (isSpeculativeCreatedBy(rec.createdBy)) {
    rec.createdBy = "send";
  }
  rec.lastActivityAt = Date.now();
  pushRuntimeChanged(rec);
}

/**
 * 登记一次真实 spawn（含 SESSION_IPC.start 常规路径）。
 * 不做 ready 探针；渲染层可先看到 starting，再由 markRuntimeReady / waitRuntimeReady 推进。
 */
export function noteSessionSpawned(input: {
  sessionId: SessionId;
  sessionFile: string | null;
  cwd: string | null;
  reason?: SessionStartReason;
}): void {
  const reason = input.reason ?? "manual";
  records.delete(input.sessionId);
  const rec = ensureRecord(input.sessionId, {
    sessionFile: input.sessionFile,
    cwd: input.cwd,
  });
  if (rec.sessionFile == null && input.sessionFile) rec.sessionFile = input.sessionFile;
  if (rec.cwd == null && input.cwd) rec.cwd = input.cwd;
  rec.startedAt = Date.now();
  rec.reason = reason;
  rec.createdBy = reason;
  rec.usedByUser = !isSpeculativeCreatedBy(reason);
  rec.extensionFingerprint = currentExtensionFingerprint(input.cwd);
  rec.state = "starting";
  rec.errorCode = undefined;
  rec.errorMessage = undefined;
  rec.readyPromise = null;
  rec.lastActivityAt = Date.now();
  pushRuntimeChanged(rec);
}

/** 标记 RPC 已可用（start IPC 模型对齐后 / ready 探针成功）。 */
export function markRuntimeReady(sessionId: SessionId): void {
  const rec = ensureRecord(sessionId, {});
  if (!hasSession(sessionId)) return;
  rec.readyPromise = null;
  rec.lastActivityAt = Date.now();
  rec.errorCode = undefined;
  rec.errorMessage = undefined;
  if (rec.state !== "busy") rec.state = "idle";
  pushRuntimeChanged(rec);
}

/** 扩展变更后：fingerprint 过期的存活 runtime 标 stale（只提示不重启）。 */
export function markExtensionStale(): void {
  for (const rec of records.values()) {
    if (rec.state !== "cold" && rec.state !== "failed") {
      pushRuntimeChanged(rec);
    }
  }
}

export function currentExtensionFingerprint(projectDir?: string | null): string | null {
  try {
    return getCatalogSnapshot(projectDir ?? null).fingerprint;
  } catch {
    return null;
  }
}

/**
 * RPC ready barrier：对存活实例发轻量 get_state 探针。
 * spawn 成功不等于 ready；探针成功才把状态推进到 ready/idle。
 */
export async function waitRuntimeReady(
  sessionId: SessionId,
  timeoutMs = RUNTIME_READY_TIMEOUT_MS,
): Promise<void> {
  const rec = ensureRecord(sessionId, {});
  if (rec.state === "ready" || rec.state === "idle" || rec.state === "busy") {
    return;
  }
  if (rec.readyPromise) return rec.readyPromise;

  const run = (async () => {
    patchRecord(sessionId, { state: "starting" });
    const deadline = Date.now() + timeoutMs;
    let lastError = "runtime-ready-timeout";

    while (Date.now() < deadline) {
      if (!hasSession(sessionId)) {
        rec.readyPromise = null;
        patchRecord(sessionId, {
          state: "failed",
          errorCode: "runtime-ready-timeout",
          errorMessage: "pi 进程未存活",
        });
        throw Object.assign(new Error("pi 进程未存活"), {
          code: "runtime-ready-timeout" as SessionRuntimeErrorCode,
        });
      }
      try {
        const state = await fetchSessionState(sessionId, Math.max(1, deadline - Date.now()));
        if (!state || typeof state !== "object" || Array.isArray(state)) {
          throw new Error("get_state 返回无效状态");
        }
        if (!hasSession(sessionId) || records.get(sessionId) !== rec) {
          throw new Error("pi 进程已退出");
        }
        rec.readyPromise = null;
        rec.lastActivityAt = Date.now();
        patchRecord(sessionId, {
          state: rec.state === "busy" ? "busy" : "idle",
          errorMessage: undefined,
          errorCode: undefined,
        });
        return;
      } catch (err) {
        if (records.get(sessionId) !== rec) throw err;
        lastError = err instanceof Error ? err.message : String(err);
        if (Date.now() >= deadline) break;
        await new Promise((resolve) => {
          setTimeout(resolve, 200);
        });
      }
    }

    rec.readyPromise = null;
    patchRecord(sessionId, {
      state: "failed",
      errorCode: "runtime-ready-timeout",
      errorMessage: `RPC ready 探测超时：${lastError}`,
    });
    throw Object.assign(new Error("RPC ready 探测超时"), {
      code: "runtime-ready-timeout" as SessionRuntimeErrorCode,
    });
  })();

  rec.readyPromise = run;
  return run;
}

function classifyStartError(err: unknown): {
  code: SessionRuntimeErrorCode;
  message: string;
  limit?: SessionLimitReachedError;
} {
  const message = err instanceof Error ? err.message : String(err);
  const limitMatch = message.match(/并行会话已达上限（(\d+)）/);
  if (limitMatch) {
    const limit = Number(limitMatch[1]);
    return {
      code: "limit-reached",
      message,
      limit: {
        code: "limit-reached",
        limit,
        idleCandidateIds: listIdleCandidateIds(),
        message,
      },
    };
  }
  if (message.includes("正在结束")) {
    return { code: "shutting-down", message };
  }
  return { code: "spawn-failed", message };
}

/** idle 候选：runtime 为 idle/ready 且进程仍存活。 */
function listIdleCandidateIds(): SessionId[] {
  const out: SessionId[] = [];
  for (const rec of records.values()) {
    if ((rec.state === "idle" || rec.state === "ready") && hasSession(rec.sessionId)) {
      out.push(rec.sessionId);
    }
  }
  return out;
}

/**
 * 协调器入口：start/reuse + ready barrier + 原因登记。
 * 同 file 复用继续走 SessionRegistry；本层只叠加 runtime 状态。
 */
export async function ensureSessionReady(
  req: CoordinatorStartRequest,
): Promise<{ sessionId: SessionId; reused: boolean }> {
  const reason = req.reason ?? "manual";
  const startedAtMs = Date.now();
  const isExplicitUser = !isSpeculativeCreatedBy(reason);

  const promote = (rec: RuntimeRecord): void => {
    if (isExplicitUser) {
      rec.usedByUser = true;
      if (isSpeculativeCreatedBy(rec.createdBy)) {
        rec.createdBy = reason;
      }
    }
  };

  /** 显式启动的命中记账：预热是否在用户动作前把实例拉到 ready（docs/design/44 A4）。 */
  const noteOutcome = (hit: boolean): void => {
    if (!isExplicitUser) return;
    if (hit) prefetchStats.hits += 1;
    else prefetchStats.misses += 1;
  };

  const noteExplicitLatency = (): void => {
    if (reason === "send") recordSendLatency(Date.now() - startedAtMs);
    if (reason === "view-action") recordReadyLatency(Date.now() - startedAtMs);
  };

  // 同 file 已有 ready 实例：直接复用，不二次 spawn
  if (req.sessionFile) {
    for (const rec of records.values()) {
      if (rec.sessionFile === req.sessionFile && hasSession(rec.sessionId)) {
        const hit = isReadyState(rec.state);
        rec.lastActivityAt = Date.now();
        promote(rec);
        pushRuntimeChanged(rec);
        await waitRuntimeReady(rec.sessionId);
        noteOutcome(hit);
        noteExplicitLatency();
        return { sessionId: rec.sessionId, reused: true };
      }
    }
  }

  // 显式使用必须先晋升，避免容量回收误杀正在复用的预热会话。
  const requested = req.sessionId ? records.get(req.sessionId) : undefined;
  if (requested && hasSession(requested.sessionId)) {
    const hit = isReadyState(requested.state);
    promote(requested);
    pushRuntimeChanged(requested);
    await waitRuntimeReady(requested.sessionId);
    noteOutcome(hit);
    noteExplicitLatency();
    return { sessionId: requested.sessionId, reused: true };
  }
  if (isExplicitUser) {
    await Promise.all(reclaimSpeculativeSessions().map(waitForSessionDisposal));
  }

  let sessionId: SessionId;
  try {
    sessionId = await startSession({
      sessionId: req.sessionId,
      cwd: req.cwd,
      sessionFile: req.sessionFile,
      reason,
    });
  } catch (err) {
    const classified = classifyStartError(err);
    if (req.sessionId) {
      ensureRecord(req.sessionId, {
        sessionFile: req.sessionFile ?? null,
        cwd: req.cwd ?? null,
      });
      patchRecord(req.sessionId, {
        state: "failed",
        errorCode: classified.code,
        errorMessage: classified.message,
        reason,
        readyPromise: null,
      });
    }
    if (classified.limit) {
      throw Object.assign(new Error(classified.message), {
        code: "limit-reached",
        limitInfo: classified.limit,
      });
    }
    throw Object.assign(new Error(classified.message), { code: classified.code });
  }

  // spawn 已登记实际 cwd/fingerprint；请求的缺省值不能覆盖它们。
  const rec =
    records.get(sessionId) ??
    ensureRecord(sessionId, {
      sessionFile: req.sessionFile ?? null,
      cwd: req.cwd ?? null,
    });
  const reused =
    rec.startedAt !== null &&
    (rec.state === "ready" || rec.state === "idle" || rec.state === "busy");

  if (!reused) {
    rec.reason = reason;
    if (rec.createdBy === null) rec.createdBy = reason;
    if (rec.startedAt === null) rec.startedAt = Date.now();
    if (rec.extensionFingerprint === null)
      rec.extensionFingerprint = currentExtensionFingerprint(rec.cwd);
    rec.errorCode = undefined;
    rec.errorMessage = undefined;
    promote(rec);
    patchRecord(sessionId, { state: "starting" });
  } else {
    rec.lastActivityAt = Date.now();
    promote(rec);
    pushRuntimeChanged(rec);
  }

  try {
    await waitRuntimeReady(sessionId);
  } catch (err) {
    const code = (err as { code?: SessionRuntimeErrorCode }).code;
    if (!reused) {
      try {
        disposeSession(sessionId);
      } catch {
        // dispose 失败不影响错误上抛
      }
      patchRecord(sessionId, {
        state: "failed",
        errorCode: code ?? "runtime-ready-timeout",
        errorMessage: err instanceof Error ? err.message : String(err),
        readyPromise: null,
      });
    }
    throw err;
  }

  noteOutcome(reused);
  noteExplicitLatency();

  return { sessionId, reused };
}

/** 该会话是否有激活事务在途（回收判定用）。 */
function hasActivationTxnFor(sessionId: SessionId): boolean {
  for (const key of activationLocks.keys()) {
    if (key.startsWith(`${sessionId}::`)) return true;
  }
  return false;
}

/**
 * 回收 speculative 实例（docs/design/16 §8.3）：
 * 仅预热创建（speculative-prefetch / new-chat-prefetch）、从未显式使用、非 busy、无激活事务。
 * user-owned / 已晋升实例永不自动回收。
 */
export function reclaimSpeculativeSessions(): SessionId[] {
  const reclaimed: SessionId[] = [];
  for (const rec of [...records.values()]) {
    const childAlive = hasSession(rec.sessionId);
    if (
      !canReclaimSpeculative({
        createdBy: rec.createdBy,
        usedByUser: rec.usedByUser,
        state: rec.state,
        hasActivationTxn: hasActivationTxnFor(rec.sessionId),
        childAlive,
      })
    ) {
      if (isSpeculativeCreatedBy(rec.createdBy) && !childAlive && rec.state === "cold") {
        records.delete(rec.sessionId);
      }
      continue;
    }
    try {
      disposeSession(rec.sessionId);
    } catch {
      // ignore
    }
    records.delete(rec.sessionId);
    reclaimed.push(rec.sessionId);
  }
  if (reclaimed.length > 0) {
    prefetchStats.reclaimed += reclaimed.length;
  }
  return reclaimed;
}

/**
 * 新 hint 到达时的定向清理（docs/design/44 A3）：回收/顶掉与当前 hint 不匹配的预热实例——
 * idle/ready 走常规回收，starting 走 supersede（用户已离开，mid-boot 终止安全：
 * 尚未落盘、无人等待，在途 waitRuntimeReady 会因 hasSession=false 退出）。
 */
export function reclaimStaleSpeculativeSessions(keep: {
  sessionId?: string;
  sessionFile?: string | null;
}): SessionId[] {
  const reclaimed: SessionId[] = [];
  for (const rec of [...records.values()]) {
    if (!isSpeculativeCreatedBy(rec.createdBy)) continue;
    if (keep.sessionId && rec.sessionId === keep.sessionId) continue;
    if (keep.sessionFile && rec.sessionFile === keep.sessionFile) continue;
    const childAlive = hasSession(rec.sessionId);
    const base = {
      createdBy: rec.createdBy,
      usedByUser: rec.usedByUser,
      hasActivationTxn: hasActivationTxnFor(rec.sessionId),
      childAlive,
    };
    const stale =
      canReclaimSpeculative({ ...base, state: rec.state }) ||
      canSupersedeSpeculative({ ...base, state: rec.state });
    if (!stale) continue;
    try {
      disposeSession(rec.sessionId);
    } catch {
      // ignore
    }
    records.delete(rec.sessionId);
    reclaimed.push(rec.sessionId);
  }
  if (reclaimed.length > 0) {
    prefetchStats.reclaimed += reclaimed.length;
  }
  return reclaimed;
}

/**
 * 主进程权威 runtime 快照。
 * `includeHidden=false`（默认，渲染层 IPC 用）时跳过未晋升的新会话预热实例
 * （docs/design/44 A2：渲染层无桶，推送会造幽灵桶）；主进程内部判定传 true。
 */
export function listRuntimeSnapshots(includeHidden = false): SessionRuntimeSnapshot[] {
  for (const rec of records.values()) {
    if (!hasSession(rec.sessionId) && rec.state !== "cold" && rec.state !== "failed") {
      rec.state = "cold";
      rec.readyPromise = null;
    }
  }
  const visible = [...records.values()].filter(
    (rec) => includeHidden || !isHiddenFromRenderer(rec),
  );
  return visible.map(toSnapshot);
}

/** 激活事务互斥：同 sessionId+contributionKey 合并重复点击。 */
export function withActivationLock<T>(
  sessionId: SessionId,
  contributionKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = lockKey(sessionId, contributionKey);
  const existing = activationLocks.get(key);
  if (existing) return existing as Promise<T>;
  const prior = [...activationLocks.entries()]
    .filter(([other]) => other.startsWith(`${sessionId}::`))
    .map(([, pending]) => pending);
  const run = prior.length ? Promise.allSettled(prior).then(fn) : fn();
  const promise = run.finally(() => {
    activationLocks.delete(key);
  });
  activationLocks.set(key, promise);
  return promise;
}

export function isActivationInFlight(sessionId: SessionId, contributionKey: string): boolean {
  return activationLocks.has(lockKey(sessionId, contributionKey));
}

/** Prompt 与模式事务共享主进程屏障，防止 IPC 到达顺序造成抢跑。 */
export function assertNoModeTransition(sessionId: SessionId): void {
  if ([...activationLocks.keys()].some((key) => key.startsWith(`${sessionId}::`))) {
    throw new Error("正在切换访问模式");
  }
}

/**
 * 指定会话是否有模式切换事务在途（assertNoModeTransition 的只读版）。
 * 调度器等非 UI 派发路径用它做冲突判定：切换中的会话视为忙，不插 prompt。
 */
export function hasModeTransition(sessionId: SessionId): boolean {
  return [...activationLocks.keys()].some((key) => key.startsWith(`${sessionId}::`));
}

/** 测试用。 */
export function __resetRuntimeCoordinatorForTests(): void {
  records.clear();
  activationLocks.clear();
  activityListeners.clear();
  prefetchStats.attempts = 0;
  prefetchStats.skippedLimit = 0;
  prefetchStats.reclaimed = 0;
  prefetchStats.readySamples.length = 0;
  prefetchStats.sendSamples.length = 0;
  prefetchStats.hits = 0;
  prefetchStats.misses = 0;
}

export { RUNTIME_IPC };
