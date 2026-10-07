import { StopCircle, Terminal } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ManagedProcess } from "../../../../shared/ipc";
import { useNowTick } from "../../../hooks/useNowTick";
import { useT } from "../../../hooks/useT";
import { procService } from "../../../services/procService";
import { refreshSessionProcesses, useSessionProcesses } from "../../../stores/procStore";
import { useSessionMeta } from "../../../stores/sessionStore";
import { formatElapsed } from "../../../utils/time";
import styles from "./BackgroundProcsCard.module.css";

/**
 * 中央会话区右上角后台进程悬浮卡片（docs/design/37 §4.3）。
 * 只做登记与停止，不复用 xterm、不显示输出流；无存活项时整卡不渲染。
 */
export function BackgroundProcsCard() {
  const t = useT();
  const { activeSessionId, processAlive } = useSessionMeta();
  const processes = useSessionProcesses(activeSessionId);
  const alive = processes.filter((p) => p.status === "alive");
  const now = useNowTick(alive.length > 0, 1000);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());

  // 切换会话时清掉上一会话的行内错误（activeSessionId 是重置信号）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖 activeSessionId 作为重置信号
  useEffect(() => {
    setErrors(new Map());
    setPendingIds(new Set());
  }, [activeSessionId]);

  // 打开浮窗时 lazy 复核 + 周期对账（§5.2）：agent 自己杀掉的 PID 标 exited
  useEffect(() => {
    if (!activeSessionId || alive.length === 0) return;
    void refreshSessionProcesses(activeSessionId);
    const timer = window.setInterval(() => {
      void refreshSessionProcesses(activeSessionId);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, alive.length]);

  if (!activeSessionId || alive.length === 0) return null;

  const stopOne = async (proc: ManagedProcess): Promise<void> => {
    setPendingIds((prev) => new Set(prev).add(proc.id));
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
  };

  const ignoreOne = async (proc: ManagedProcess): Promise<void> => {
    try {
      await procService.ignore(proc.id);
    } catch {
      // 忽略失败不打扰
    }
  };

  return (
    <aside className={styles.card} aria-label={t("proc.card.title")}>
      <header className={styles.header}>
        <span className={styles.title}>{t("proc.card.header", { count: alive.length })}</span>
      </header>
      {!processAlive ? (
        <p className={styles.sessionEnded}>{t("proc.card.sessionEndedHint")}</p>
      ) : null}
      <ul className={styles.list}>
        {alive.map((proc) => {
          const label = proc.commandLine || proc.name;
          const pending = pendingIds.has(proc.id);
          const error = errors.get(proc.id);
          return (
            <li key={proc.id} className={styles.row}>
              <Terminal size={16} weight="regular" className={styles.rowIcon} />
              <div className={styles.rowBody}>
                <div className={styles.rowTitle} title={proc.commandLine || proc.name}>
                  {summarize(label)}
                </div>
                <div className={styles.rowMeta}>
                  <span>
                    {t("proc.elapsed.prefix")}
                    {formatElapsed(now - proc.startedAt)}
                  </span>
                  {error ? <span className={styles.rowError}>{error}</span> : null}
                </div>
              </div>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.action}
                  disabled={pending}
                  title={t("proc.card.ignoreLabel", { name: summarize(label) })}
                  aria-label={t("proc.card.ignoreLabel", { name: summarize(label) })}
                  onClick={() => {
                    void ignoreOne(proc);
                  }}
                >
                  {t("proc.card.ignore")}
                </button>
                <button
                  type="button"
                  className={styles.stop}
                  disabled={pending}
                  title={t("proc.card.stopLabel", { name: summarize(label) })}
                  aria-label={t("proc.card.stopLabel", { name: summarize(label) })}
                  onClick={() => {
                    void stopOne(proc);
                  }}
                >
                  <StopCircle size={16} weight="regular" />
                  {pending ? t("proc.card.stopping") : t("proc.card.stop")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function summarize(commandLine: string): string {
  const raw = commandLine.trim().replace(/\s+/g, " ");
  if (raw.length <= 36) return raw;
  return `${raw.slice(0, 35)}…`;
}
