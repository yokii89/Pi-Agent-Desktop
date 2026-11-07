import { useEffect, useMemo } from "react";
import type { ManagedProcess, SessionId } from "../../shared/ipc";
import {
  acquireProcReconcile,
  ignoreManagedProcess,
  refreshSessionProcesses,
  stopManagedProcess,
  useProcActionFeedback,
  useSessionProcesses,
} from "../stores/procStore";
import { readableCommand } from "../utils/commandIcon";
import { orderProcesses } from "../utils/procRows";
import { useNowTick } from "./useNowTick";

/** 后台进程区的取数与动作：右侧会话监控卡与「后台进程」详情页签共用（docs/design/37 / 96）。 */
export interface ProcActions {
  /** 全部登记项（存活在前、已结束在后、忽略已剔除），带状态的列表用。 */
  all: ManagedProcess[];
  /** 秒级心跳（运行时长展示用）。 */
  now: number;
  /** 正在停止的进程 id。 */
  pendingIds: ReadonlySet<string>;
  /** 逐行停止失败的说明（pid 复用 / 权限等）。 */
  errors: ReadonlyMap<string, string>;
  stop: (proc: ManagedProcess) => void;
  ignore: (proc: ManagedProcess) => void;
}

/**
 * 后台进程登记 + 停止/忽略动作。
 *
 * 只有一份实现的原因：几处 UI 表达的是同一份登记表，分开写会走出两套
 * 失败文案与两种对账节奏（一个 5s 复核、一个不核对），停止结果就对不上。
 * pending/errors 与 5s 对账都在 procStore（引用计数）：同一会话只跑一个 interval。
 */
export function useProcActions(sessionId: SessionId | null): ProcActions {
  const processes = useSessionProcesses(sessionId);
  const hasAlive = processes.some((proc) => proc.status === "alive");
  const all = useMemo(() => orderProcesses(processes), [processes]);
  const now = useNowTick(hasAlive, 1000);
  const { pendingIds, errors } = useProcActionFeedback();

  useEffect(() => {
    if (!sessionId) return;
    if (!hasAlive) {
      // 本地桶为空也必须拉一次：渲染层 reload 后主进程不会重放既有登记项
      void refreshSessionProcesses(sessionId);
      return;
    }
    return acquireProcReconcile(sessionId);
  }, [sessionId, hasAlive]);

  return {
    all,
    now,
    pendingIds,
    errors,
    stop: (proc: ManagedProcess): void => {
      void stopManagedProcess(proc);
    },
    ignore: (proc: ManagedProcess): void => {
      void ignoreManagedProcess(proc);
    },
  };
}

/** 命令摘要：可执行主体换 basename（Win32 枚举出的是带引号绝对路径），折叠空白并截断；标题/aria 里用完整命令行。 */
export function summarizeCommand(commandLine: string, max = 36): string {
  const raw = readableCommand(commandLine).trim().replace(/\s+/g, " ");
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}
