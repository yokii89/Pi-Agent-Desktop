import { ChatCircleDots, CheckCircle, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import type { ScheduledRunRecord, ScheduledTask } from "../../../shared/scheduler";
import { useT } from "../../hooks/useT";
import { useSessionMeta } from "../../stores/sessionStore";
import { formatAbsoluteTime } from "../../utils/time";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import styles from "./ScheduledTasksPage.module.css";
import { formatDeviation } from "./scheduleText";

interface ScheduledTaskRunsDialogProps {
  open: boolean;
  task: ScheduledTask | null;
  /** 该任务的运行台账（调用方过滤）。 */
  runs: ScheduledRunRecord[];
  onClose: () => void;
}

function statusDotClass(status: ScheduledRunRecord["status"]): string {
  if (status === "skipped") return `${styles.statusDot} ${styles.statusSkipped}`;
  if (status === "failed") return `${styles.statusDot} ${styles.statusFailed}`;
  return `${styles.statusDot} ${styles.statusDispatched}`;
}

/** 运行历史：一次触发一行；只陈述「派发/跳过/失败到派发为止」，agent 执行结果在会话流里看。 */
export function ScheduledTaskRunsDialog({
  open,
  task,
  runs,
  onClose,
}: ScheduledTaskRunsDialogProps) {
  const t = useT();
  const { openSessionFile } = useSessionMeta();

  const triggerLabel = (trigger: ScheduledRunRecord["trigger"]): string => {
    if (trigger === "catch-up") return t("scheduled.runs.trigger.catchUp");
    if (trigger === "manual") return t("scheduled.runs.trigger.manual");
    return t("scheduled.runs.trigger.schedule");
  };

  const statusLabel = (run: ScheduledRunRecord): string => {
    if (run.status === "skipped") {
      const reason =
        run.skipReason === "expired"
          ? t("scheduled.runs.skip.expired")
          : t("scheduled.runs.skip.conflict");
      return `${t("scheduled.runs.status.skipped")} · ${reason}`;
    }
    if (run.status === "failed") return t("scheduled.runs.status.failed");
    return run.finishedAt
      ? `${t("scheduled.runs.status.dispatched")} · ${t("scheduled.runs.finished")} ${formatAbsoluteTime(run.finishedAt)}`
      : t("scheduled.runs.status.dispatched");
  };

  const statusIcon = (run: ScheduledRunRecord): ReactElement => {
    if (run.status === "skipped") return <WarningCircle size={16} weight="regular" />;
    if (run.status === "failed") return <XCircle size={16} weight="regular" />;
    if (run.finishedAt) return <CheckCircle size={16} weight="regular" />;
    return <ChatCircleDots size={16} weight="regular" />;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={t("scheduled.runs.title")}
      panelClassName={styles.runsDialogPanel}
    >
      <div className={styles.dialogHeader}>
        <h2 className={styles.dialogTitle}>
          {task ? `${t("scheduled.runs.title")} · ${task.name}` : t("scheduled.runs.title")}
        </h2>
        <IconButton title={t("common.cancel")} onClick={onClose}>
          <X size={18} weight="regular" />
        </IconButton>
      </div>
      <div className={styles.runsBody}>
        {runs.length === 0 ? (
          <div className={styles.runsEmpty}>{t("scheduled.runs.empty")}</div>
        ) : (
          runs.map((run) => (
            <div key={run.id} className={styles.runRow}>
              <span className={statusDotClass(run.status)} aria-hidden="true" />
              <div className={styles.runMain}>
                <div className={styles.runLine}>
                  <span className={styles.runStatus}>
                    {statusIcon(run)}
                    {statusLabel(run)}
                  </span>
                  <span className={styles.runMuted}>
                    {t("scheduled.runs.col.trigger")}: {triggerLabel(run.trigger)}
                  </span>
                  {run.missedCount ? (
                    <span className={styles.runMuted}>
                      {t("scheduled.runs.missed", { n: run.missedCount })}
                    </span>
                  ) : null}
                </div>
                <div className={styles.runLine}>
                  <span className={styles.runMuted}>
                    {t("scheduled.runs.col.scheduledAt")}: {formatAbsoluteTime(run.scheduledAt)}
                  </span>
                  <span className={styles.runMuted}>
                    {t("scheduled.runs.col.deviation")}: {formatDeviation(run.deviationMs)}
                  </span>
                  {run.error ? (
                    <span className={styles.runError}>
                      {t("scheduled.runs.error", { error: run.error })}
                    </span>
                  ) : null}
                </div>
              </div>
              {run.sessionFile ? (
                <IconButton
                  title={t("scheduled.runs.openSession")}
                  onClick={() =>
                    void openSessionFile(run.sessionFile as string, task?.cwd ?? undefined)
                  }
                >
                  <ChatCircleDots size={18} weight="regular" />
                </IconButton>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
