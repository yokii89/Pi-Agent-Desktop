import type { PiSessionStats, SessionId } from "../../shared/ipc";

/** 合并密集消息完成事件，同时给持续工具调用保留周期性的刷新机会。 */
const CONTEXT_USAGE_REFRESH_DELAY_MS = 250;

interface PendingRefresh {
  timer: ReturnType<typeof setTimeout> | null;
  task: Promise<void> | null;
  dirty: boolean;
  immediate: boolean;
}

/** 按会话合并用量请求；同会话串行读取，取消后不再交付迟到结果。 */
export function createContextUsageRefresh(
  read: (sessionId: SessionId) => Promise<PiSessionStats | null>,
  apply: (sessionId: SessionId, stats: PiSessionStats) => void,
) {
  const pending = new Map<SessionId, PendingRefresh>();

  const entryFor = (id: SessionId): PendingRefresh => {
    let entry = pending.get(id);
    if (!entry) {
      entry = { timer: null, task: null, dirty: false, immediate: false };
      pending.set(id, entry);
    }
    return entry;
  };

  const defer = (id: SessionId, entry: PendingRefresh): void => {
    // 不因后续事件重置计时器，避免连续工具调用让刷新一直等不到空档。
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void run(id, entry);
    }, CONTEXT_USAGE_REFRESH_DELAY_MS);
  };

  const run = (id: SessionId, entry: PendingRefresh): Promise<void> => {
    const task = async (): Promise<void> => {
      try {
        do {
          entry.dirty = false;
          entry.immediate = false;
          // 暂时失败保留上次读数；压缩后的未知量由非空 stats 原样交付。
          const stats = await read(id).catch(() => null);
          if (pending.get(id) !== entry) return;
          // 压缩、切模型或收口期间发起的立即刷新必须重新读，不能交付旧快照。
          if (stats && !entry.immediate) apply(id, stats);
        } while (entry.dirty && entry.immediate);
      } finally {
        entry.task = null;
        if (pending.get(id) === entry) {
          if (entry.dirty) defer(id, entry);
          else pending.delete(id);
        }
      }
    };
    entry.task = task();
    return entry.task;
  };

  const cancel = (id: SessionId): void => {
    const entry = pending.get(id);
    if (entry && entry.timer !== null) clearTimeout(entry.timer);
    pending.delete(id);
  };

  return {
    /** 消息完成后合并刷新；在途期间的新事件会再补一次读取。 */
    schedule(id: SessionId): void {
      const entry = entryFor(id);
      entry.dirty = true;
      if (!entry.task && entry.timer === null) defer(id, entry);
    },
    /** 手动操作与收口跳过合并等待；在途请求完成后补读最新快照。 */
    refresh(id: SessionId): Promise<void> {
      const entry = entryFor(id);
      entry.dirty = true;
      entry.immediate = true;
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      return entry.task ?? run(id, entry);
    },
    /** 进程退出后停止刷新，并忽略该实例尚未返回的结果。 */
    cancel,
    /** 清理 Provider 生命周期；之后仍可重新调度，兼容 StrictMode 重挂 effect。 */
    clear(): void {
      for (const id of pending.keys()) cancel(id);
    },
  };
}
