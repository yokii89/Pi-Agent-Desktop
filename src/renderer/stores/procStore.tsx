import { useSyncExternalStore } from "react";
import { t } from "../../shared/i18n";
import type { ManagedProcess, SessionId } from "../../shared/ipc";
import { PROC_OUTPUT_TAIL_CAP } from "../../shared/ipc";
import { procService } from "../services/procService";

/**
 * 后台进程登记的轻量外部存储（docs/design/37）。
 * 按 sessionId 分桶，对齐 sessionStore 风格但独立域，不进 session 桶。
 * 详情页签的选中项、停止动作的 pending/error、5s 存活对账也收在这里：
 * 浮卡 / 监控卡 / 详情面板同时挂着同一份登记表，任何一份都不能各跑一条轮询。
 */
type ProcState = ReadonlyMap<SessionId, readonly ManagedProcess[]>;

let state: ProcState = new Map();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: ProcState): void {
  state = next;
  emit();
}

export const procStore = {
  get(): ProcState {
    return state;
  },
  list(sessionId: SessionId | null | undefined): readonly ManagedProcess[] {
    if (!sessionId) return [];
    return state.get(sessionId) ?? [];
  },
  alive(sessionId: SessionId | null | undefined): ManagedProcess[] {
    return procStore.list(sessionId).filter((p) => p.status === "alive");
  },
  aliveCount(sessionId: SessionId | null | undefined): number {
    return procStore.alive(sessionId).length;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** 本地合并一次推送（乐观更新用）。 */
  applySession(sessionId: SessionId, processes: readonly ManagedProcess[]): void {
    const next = new Map(state);
    next.set(sessionId, processes);
    setState(next);
    pruneOutputs(processes);
  },
};

/** 订阅该会话的登记列表（仅 alive 计数用时可只读 length）。 */
export function useSessionProcesses(
  sessionId: SessionId | null | undefined,
): readonly ManagedProcess[] {
  const map = useSyncExternalStore(procStore.subscribe, procStore.get);
  if (!sessionId) return [];
  return map.get(sessionId) ?? [];
}

/** 该会话存活后台进程数（浮窗与结束确认用）。 */
export function useAliveProcCount(sessionId: SessionId | null | undefined): number {
  const procs = useSessionProcesses(sessionId);
  return procs.filter((p) => p.status === "alive").length;
}

/**
 * 接线主进程推送；在应用根挂载一次。
 * 登记表以 push 为准，打开浮窗/确认框前再 list 对账。
 */
export function bindProcStream(): () => void {
  return procService.onChanged((message) => {
    procStore.applySession(message.sessionId, message.processes);
  });
}

const refreshInFlight = new Map<SessionId, Promise<void>>();

/**
 * 拉取并对账某会话的登记列表（打开浮窗 / 挂载 / 结束确认前）。
 * 同会话共用一个在途请求：reload 后浮卡、监控卡、详情页可能同时触发首次对账，
 * 不合并会各起一条 1.5s 的进程枚举。
 */
export function refreshSessionProcesses(sessionId: SessionId): Promise<void> {
  const inFlight = refreshInFlight.get(sessionId);
  if (inFlight) return inFlight;
  // 先让出一次微任务再干活：procService.list 可能同步抛（preload 未就绪），
  // 若 body 同步走完 finally 再 set，会留下一个永远删不掉的已完成条目。
  const task = Promise.resolve()
    .then(async () => {
      try {
        const list = await procService.list(sessionId);
        procStore.applySession(sessionId, list);
      } catch {
        // 枚举失败不打扰 UI
      }
    })
    .finally(() => {
      refreshInFlight.delete(sessionId);
    });
  refreshInFlight.set(sessionId, task);
  return task;
}

// ---------------------------------------------------------------------------
// 详情页签的选中项
// ---------------------------------------------------------------------------

let selectedProcId: string | null = null;

/** 选中一个进程（详情页签打开前调用）；null 表示不指定。 */
export function selectProc(id: string | null): void {
  if (selectedProcId === id) return;
  selectedProcId = id;
  emit();
}

export function useSelectedProcId(): string | null {
  return useSyncExternalStore(procStore.subscribe, () => selectedProcId);
}

// ---------------------------------------------------------------------------
// 停止 / 忽略动作的共享反馈
// ---------------------------------------------------------------------------

export interface ProcActionFeedback {
  /** 正在停止的进程 id（三处 UI 同步禁用）。 */
  pendingIds: ReadonlySet<string>;
  /** 逐行停止失败的说明（pid 复用 / 权限等）。 */
  errors: ReadonlyMap<string, string>;
}

let actionFeedback: ProcActionFeedback = { pendingIds: new Set(), errors: new Map() };
const actionListeners = new Set<() => void>();

function emitAction(): void {
  for (const listener of actionListeners) listener();
}

function subscribeAction(listener: () => void): () => void {
  actionListeners.add(listener);
  return () => {
    actionListeners.delete(listener);
  };
}

function getActionFeedback(): ProcActionFeedback {
  return actionFeedback;
}

export function useProcActionFeedback(): ProcActionFeedback {
  return useSyncExternalStore(subscribeAction, getActionFeedback);
}

function setPending(id: string, pending: boolean): void {
  const next = new Set(actionFeedback.pendingIds);
  if (pending) next.add(id);
  else next.delete(id);
  actionFeedback = { ...actionFeedback, pendingIds: next };
  emitAction();
}

function setStopError(id: string, message: string): void {
  actionFeedback = {
    ...actionFeedback,
    errors: new Map(actionFeedback.errors).set(id, message),
  };
  emitAction();
}

/** 重试前清掉旧错误：否则成功后这条错误会一直挂在已结束的行上。 */
function clearStopError(id: string): void {
  if (!actionFeedback.errors.has(id)) return;
  const errors = new Map(actionFeedback.errors);
  errors.delete(id);
  actionFeedback = { ...actionFeedback, errors };
  emitAction();
}

/** 停止一个登记项；失败原因写进共享反馈（三处 UI 看到同一条）。 */
export async function stopManagedProcess(proc: ManagedProcess): Promise<void> {
  if (actionFeedback.pendingIds.has(proc.id)) return;
  clearStopError(proc.id);
  setPending(proc.id, true);
  try {
    const result = await procService.stop(proc.id);
    if (result.stillAlive) {
      const message =
        result.message === "进程已变化，未终止"
          ? t("proc.card.pidReused")
          : (result.message ?? t("proc.card.stopFailed"));
      setStopError(proc.id, message);
    }
  } catch {
    setStopError(proc.id, t("proc.card.stopFailed"));
  } finally {
    setPending(proc.id, false);
  }
}

/** 标记忽略；失败不打扰。 */
export async function ignoreManagedProcess(proc: ManagedProcess): Promise<void> {
  try {
    await procService.ignore(proc.id);
  } catch {
    // 忽略失败不打扰
  }
}

/** 登记表是 feed 的生命周期来源：行消失（忽略/清理/换代出旧行）时同步丢弃对应 feed。 */
function pruneOutputs(processes: readonly ManagedProcess[]): void {
  if (outputState.feeds.size === 0) return;
  const known = new Set(processes.map((proc) => proc.id));
  let removed = false;
  const next = new Map(outputState.feeds);
  for (const id of next.keys()) {
    if (!known.has(id)) {
      next.delete(id);
      removed = true;
    }
  }
  if (removed) {
    outputState = { feeds: next };
    emitOutput();
  }
}

// ---------------------------------------------------------------------------
// 实时输出跟随（方案 B）：详情页签对 job 档登记项开一条作业日志 tail
// ---------------------------------------------------------------------------

/** 展示层保留的尾部字符数（与主进程单帧读入口径同一契约）。 */
const OUTPUT_TAIL_CHARS = PROC_OUTPUT_TAIL_CAP;

export interface ProcOutputFeed {
  /** 累计文本的尾部；主进程首帧从日志尾部起步，渲染层只保留最后 64KB。 */
  text: string;
  /** 已收到 ended（作业结束、跟随终止），不再有新数据。 */
  ended: boolean;
  /** feed 已启动（start 与 stop 之间）；stop 保留文本供已结束展示。 */
  active: boolean;
  /** 作业日志路径（「打开日志文件」用）；无日志（竞态）为 null。 */
  logPath: string | null;
}

let outputState: { feeds: ReadonlyMap<string, ProcOutputFeed> } = { feeds: new Map() };
const outputListeners = new Set<() => void>();

function emitOutput(): void {
  for (const listener of outputListeners) listener();
}

function subscribeOutput(listener: () => void): () => void {
  outputListeners.add(listener);
  return () => {
    outputListeners.delete(listener);
  };
}

function getOutputState(): { feeds: ReadonlyMap<string, ProcOutputFeed> } {
  return outputState;
}

function setFeed(id: string, feed: ProcOutputFeed): void {
  outputState = { feeds: new Map(outputState.feeds).set(id, feed) };
  emitOutput();
}

/** 某登记项的实时输出；未开过 feed 返回 null（store 层 getter，测试与 hook 共用）。 */
export function getProcOutput(procId: string | null | undefined): ProcOutputFeed | null {
  return procId ? (outputState.feeds.get(procId) ?? null) : null;
}

/** 某登记项的实时输出；未开过 feed 返回 null。 */
export function useProcOutput(procId: string | null | undefined): ProcOutputFeed | null {
  useSyncExternalStore(subscribeOutput, getOutputState);
  return getProcOutput(procId);
}

/** 订阅作业日志增量推送；在应用根挂载一次（与 bindProcStream 平级）。 */
export function bindProcOutputStream(): () => void {
  return procService.onOutput((message) => {
    const prev = outputState.feeds.get(message.id);
    if (message.type === "ended") {
      if (!prev || prev.ended) return;
      setFeed(message.id, { ...prev, ended: true, active: false });
      return;
    }
    if (message.payload.length === 0) return;
    let text = prev ? prev.text + message.payload : message.payload;
    if (text.length > OUTPUT_TAIL_CHARS) text = text.slice(-OUTPUT_TAIL_CHARS);
    setFeed(message.id, {
      text,
      ended: false,
      active: true,
      logPath: prev?.logPath ?? null,
    });
  });
}

/**
 * 开始跟随一个登记项的作业日志；重复调用幂等。返回日志路径（「打开日志文件」用），
 * 无 pi-bash-jobs 作业日志时为 null。
 */
export async function startOutputFeed(id: string): Promise<string | null> {
  const current = outputState.feeds.get(id);
  if (current?.active) return current.logPath;
  // 新开 feed 清掉旧文本：主进程首帧会从日志尾部 64KB 重发
  setFeed(id, { text: "", ended: false, active: true, logPath: null });
  try {
    const { logPath } = await procService.outputStart(id);
    setFeed(id, { text: "", ended: false, active: true, logPath });
    return logPath;
  } catch {
    // 主进程拒绝（登记项已消失等）：feed 留空态，UI 不展示跟随
    setFeed(id, { text: "", ended: true, active: false, logPath: null });
    return null;
  }
}

/** 停止跟随；文本保留（已结束的行继续展示尾部），只是不再有新数据。 */
export function stopOutputFeed(id: string): void {
  const current = outputState.feeds.get(id);
  void procService.outputStop(id).catch(() => {
    // 未启动 / 主进程竞态：幂等，不打扰
  });
  if (!current?.active) return;
  setFeed(id, { ...current, active: false });
}

// ---------------------------------------------------------------------------
// 每会话一份的存活对账（浮卡 / 监控卡 / 详情面板共享）
// ---------------------------------------------------------------------------

const reconcileRefs = new Map<SessionId, { count: number; timer: number }>();

/**
 * 引用计数式 5s 对账：同一个会话无论几处 UI 在屏，只跑一个 interval。
 * 第一处获取时立即对账一次；最后一处释放时停表。
 */
export function acquireProcReconcile(sessionId: SessionId): () => void {
  let entry = reconcileRefs.get(sessionId);
  if (!entry) {
    const timer = window.setInterval(() => {
      void refreshSessionProcesses(sessionId);
    }, 5000);
    entry = { count: 0, timer };
    reconcileRefs.set(sessionId, entry);
    void refreshSessionProcesses(sessionId);
  }
  entry.count += 1;
  return () => {
    const current = reconcileRefs.get(sessionId);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0) return;
    window.clearInterval(current.timer);
    reconcileRefs.delete(sessionId);
  };
}
