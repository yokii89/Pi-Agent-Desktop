import { StopCircle, Terminal } from "@phosphor-icons/react";
import { useOpenProcPanel } from "../../../hooks/useOpenProcPanel";
import { useT } from "../../../hooks/useT";
import { useSessionMeta } from "../../../stores/sessionStore";
import { formatElapsed } from "../../../utils/time";
import styles from "./BackgroundProcsCard.module.css";
import { summarizeCommand, useProcActions } from "./useProcActions";

/**
 * 中央会话区右上角后台进程悬浮卡片（docs/design/37 §4.3）。
 * 只做登记与停止，不复用 xterm、不显示输出流；无存活项时整卡不渲染。
 * 右侧栏收起时这张卡让位给会话监控卡（同一份登记表，避免两处同时挂进程列表）。
 */
export function BackgroundProcsCard() {
  const t = useT();
  const { activeSessionId, processAlive } = useSessionMeta();
  const { alive, now, pendingIds, errors, stop, ignore } = useProcActions(activeSessionId);
  const openProcPanel = useOpenProcPanel();

  if (!activeSessionId || alive.length === 0) return null;

  return (
    <aside className={styles.card} aria-label={t("proc.card.title")} data-panel-geo="monitor-procs">
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
              <button
                type="button"
                className={styles.rowBody}
                title={proc.commandLine || proc.name}
                aria-label={t("proc.panel.openLabel", { name: summarizeCommand(label) })}
                onClick={() => openProcPanel(proc)}
              >
                <span className={styles.rowTitle} title={proc.commandLine || proc.name}>
                  {summarizeCommand(label)}
                </span>
                <span className={styles.rowMeta}>
                  <span>
                    {t("proc.elapsed.prefix")}
                    {formatElapsed(now - proc.startedAt)}
                  </span>
                  {error ? <span className={styles.rowError}>{error}</span> : null}
                </span>
              </button>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.action}
                  disabled={pending}
                  title={t("proc.card.ignoreLabel", { name: summarizeCommand(label) })}
                  aria-label={t("proc.card.ignoreLabel", { name: summarizeCommand(label) })}
                  onClick={() => {
                    ignore(proc);
                  }}
                >
                  {t("proc.card.ignore")}
                </button>
                <button
                  type="button"
                  className={styles.stop}
                  disabled={pending}
                  title={t("proc.card.stopLabel", { name: summarizeCommand(label) })}
                  aria-label={t("proc.card.stopLabel", { name: summarizeCommand(label) })}
                  onClick={() => {
                    stop(proc);
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
