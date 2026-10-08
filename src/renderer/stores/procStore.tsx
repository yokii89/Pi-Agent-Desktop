import { useSyncExternalStore } from "react";
import type { ManagedProcess, SessionId } from "../../shared/ipc";
import { procService } from "../services/procService";

/**
 * 后台进程登记的轻量外部存储（docs/design/37）。
 * 按 sessionId 分桶，对齐 sessionStore 风格但独立域，不进 session 桶。
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

/** 拉取并对账某会话的登记列表（打开浮窗 / 结束确认前）。 */
export async function refreshSessionProcesses(sessionId: SessionId): Promise<void> {
  try {
    const list = await procService.list(sessionId);
    procStore.applySession(sessionId, list);
  } catch {
    // 枚举失败不打扰 UI
  }
}
