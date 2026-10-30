import { Terminal, XCircle } from "@phosphor-icons/react";
import type { ManagedProcess } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { formatElapsed } from "../../utils/time";
import { type ProcActions, summarizeCommand } from "../SessionArea/BackgroundProcs/useProcActions";
import styles from "./SessionMonitor.module.css";

/** 监控卡里的行数上限：存活优先，其余进详情页签看。 */
const MONITOR_PROC_LIMIT = 5;

interface MonitorProcsProps {
  /** 与中央区浮卡共用的登记表（useProcActions 在卡片外壳里取一次，两处不各订阅一份）。 */
  procs: ProcActions;
  /** 行内命令摘要长度：监控卡比浮卡窄，截得更短。 */
  maxCommandChars?: number;
  /** 点击进程行 → 右侧栏「后台进程」详情。 */
  onOpen: (proc: ManagedProcess) => void;
  /** 超出上限时「查看全部」→ 打开详情页签（不改变选中项）。 */
  onOpenAll: () => void;
}

/**
 * 「后台进程」区：存活在前、已结束在后，右缘显示状态（运行中 / 已停止 / 已退出）。
 * 行可点开右侧栏详情；存活行的停止按钮悬停揭示，已结束行不再提供动作。
 */
export function MonitorProcs({
  procs,
  maxCommandChars = 24,
  onOpen,
  onOpenAll,
}: MonitorProcsProps) {
  const t = useT();
  const { all, now, pendingIds, errors, stop } = procs;
  const rows = all.slice(0, MONITOR_PROC_LIMIT);
  const hidden = all.length - rows.length;

  return (
    <>
      {rows.map((proc) => {
        const label = proc.commandLine || proc.name;
        const alive = proc.status === "alive";
        const pending = pendingIds.has(proc.id);
        // 停止失败提示只在存活行展示：进程结束后状态优先，旧错误不能盖住「已停止/已退出」
        const error = alive ? errors.get(proc.id) : undefined;
        return (
          <li key={proc.id} className={styles.row}>
            <button
              type="button"
              className={styles.procOpen}
              title={alive ? `${label}\n${formatElapsed(now - proc.startedAt)}` : label}
              aria-label={t("proc.panel.openLabel", { name: summarizeCommand(label) })}
              onClick={() => onOpen(proc)}
            >
              <span className={styles.iconTile} aria-hidden="true">
                <Terminal size={16} weight="regular" />
              </span>
              <span className={styles.rowText}>{summarizeCommand(label, maxCommandChars)}</span>
            </button>
            <span className={styles.rowTrailing}>
              {error ? (
                <span className={styles.rowError}>{error}</span>
              ) : alive ? (
                <>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.running}>{t("monitor.procs.running")}</span>
                </>
              ) : (
                <>
                  <XCircle
                    size={14}
                    weight="regular"
                    className={styles.endedIcon}
                    aria-hidden="true"
                  />
                  <span className={styles.ended}>{t(`proc.panel.status.${proc.status}`)}</span>
                </>
              )}
              {/* 停止失败后错误与按钮并列：错误不能把重试入口换掉 */}
              {alive ? (
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
              ) : null}
            </span>
          </li>
        );
      })}
      {hidden > 0 ? (
        <li className={styles.row}>
          <button type="button" className={styles.viewAll} onClick={onOpenAll}>
            {t("proc.card.viewAll", { count: all.length })}
          </button>
        </li>
      ) : null}
    </>
  );
}
