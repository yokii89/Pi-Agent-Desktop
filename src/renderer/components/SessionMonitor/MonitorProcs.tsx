import { Terminal } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import { formatElapsed } from "../../utils/time";
import { type ProcActions, summarizeCommand } from "../SessionArea/BackgroundProcs/useProcActions";
import styles from "./SessionMonitor.module.css";

interface MonitorProcsProps {
  /** 与中央区浮卡共用的登记表（useProcActions 在卡片外壳里取一次，两处不各订阅一份）。 */
  procs: ProcActions;
  /** 行内命令摘要长度：监控卡比浮卡窄，截得更短。 */
  maxCommandChars?: number;
}

/**
 * 「后台进程」区：存活进程一行一条，右缘是运行状态，悬停揭示停止。
 *
 * 只保留停止，不做"忽略"——忽略是排查残留进程时的一次性动作，属于浮卡的任务。
 */
export function MonitorProcs({ procs, maxCommandChars = 24 }: MonitorProcsProps) {
  const t = useT();
  const { alive, now, pendingIds, errors, stop } = procs;

  return (
    <>
      {alive.map((proc) => {
        const label = proc.commandLine || proc.name;
        const pending = pendingIds.has(proc.id);
        const error = errors.get(proc.id);
        return (
          <li key={proc.id} className={styles.row}>
            <span className={styles.iconTile} aria-hidden="true">
              <Terminal size={16} weight="regular" />
            </span>
            <span
              className={styles.rowText}
              title={`${label}\n${formatElapsed(now - proc.startedAt)}`}
            >
              {summarizeCommand(label, maxCommandChars)}
            </span>
            <span className={styles.rowTrailing}>
              {error ? (
                <span className={styles.rowError}>{error}</span>
              ) : (
                <>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.running}>{t("monitor.procs.running")}</span>
                  <button
                    type="button"
                    className={styles.stopButton}
                    disabled={pending}
                    title={t("proc.card.stopLabel", { name: summarizeCommand(label) })}
                    aria-label={t("proc.card.stopLabel", { name: summarizeCommand(label) })}
                    onClick={() => {
                      stop(proc);
                    }}
                  >
                    {pending ? t("proc.card.stopping") : t("proc.card.stop")}
                  </button>
                </>
              )}
            </span>
          </li>
        );
      })}
    </>
  );
}
