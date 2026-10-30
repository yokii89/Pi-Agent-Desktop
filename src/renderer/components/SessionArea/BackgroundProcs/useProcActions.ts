import { useEffect, useState } from "react";
import type { ManagedProcess, SessionId } from "../../../../shared/ipc";
import { useNowTick } from "../../../hooks/useNowTick";
import { useT } from "../../../hooks/useT";
import { procService } from "../../../services/procService";
import { refreshSessionProcesses, useSessionProcesses } from "../../../stores/procStore";

/** 后台进程区的取数与动作：中央会话区浮卡与右侧会话监控卡共用（docs/design/37 / 96）。 */
export interface ProcActions {
  /** 存活进程（exited 不再展示）。 */
  alive: ManagedProcess[];
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
 * 只有一份实现的原因：两处 UI 表达的是同一份登记表，分开写会走出两套
 * 失败文案与两种对账节奏（一个 5s 复核、一个不核对），停止结果就对不上。
 */
export function useProcActions(sessionId: SessionId | null): ProcActions {
  const t = useT();
  const processes = useSessionProcesses(sessionId);
  const alive = processes.filter((proc) => proc.status === "alive");
  const now = useNowTick(alive.length > 0, 1000);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());

  // 切换会话时清掉上一会话的行内错误（sessionId 是重置信号）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖 sessionId 作为重置信号
  useEffect(() => {
    setErrors(new Map());
    setPendingIds(new Set());
  }, [sessionId]);

  // 打开时 lazy 复核 + 周期对账（§5.2）：agent 自己杀掉的 PID 标 exited
  useEffect(() => {
    if (!sessionId || alive.length === 0) return;
    void refreshSessionProcesses(sessionId);
    const timer = window.setInterval(() => {
      void refreshSessionProcesses(sessionId);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [sessionId, alive.length]);

  const stop = (proc: ManagedProcess): void => {
    setPendingIds((prev) => new Set(prev).add(proc.id));
    void (async () => {
      try {
        const result = await procService.stop(proc.id);
        if (result.stillAlive) {
          const message =
            result.message === "进程已变化，未终止"
              ? t("proc.card.pidReused")
              : (result.message ?? t("proc.card.stopFailed"));
          setErrors((prev) => new Map(prev).set(proc.id, message));
        }
      } catch {
        setErrors((prev) => new Map(prev).set(proc.id, t("proc.card.stopFailed")));
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(proc.id);
          return next;
        });
      }
    })();
  };

  const ignore = (proc: ManagedProcess): void => {
    void procService.ignore(proc.id).catch(() => {
      // 忽略失败不打扰
    });
  };

  return { alive, now, pendingIds, errors, stop, ignore };
}

/** 命令摘要：折叠空白并截断（标题/aria 里用完整命令行）。 */
export function summarizeCommand(commandLine: string, max = 36): string {
  const raw = commandLine.trim().replace(/\s+/g, " ");
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}
