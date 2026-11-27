import type { Icon } from "@phosphor-icons/react";
import {
  CaretDown,
  CaretRight,
  ChartBar,
  CheckCircle,
  Copy,
  Info,
  Robot,
  StopCircle,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { useSessionMeta } from "../../stores/sessionStore";
import type { TaskNotification } from "../../stores/taskNotification";
import { useUiStore } from "../../stores/uiStore";
import { copyTextToClipboard } from "../../utils/clipboard";
import { formatCost, formatTokens } from "../../utils/formatTokens";
import { formatElapsed } from "../../utils/time";
import { MarkdownContent } from "./MarkdownContent";
import styles from "./TaskNotice.module.css";

const STATUS_ICONS: Record<TaskNotification["status"], Icon> = {
  complete: CheckCircle,
  partial: WarningCircle,
  failed: XCircle,
  stopped: StopCircle,
  unknown: Info,
};

/** 子任务通知沿用会话文档流；展开状态只属于视图，不改写扩展正文或会话历史。 */
export function TaskNotice({ task }: { task: TaskNotification }) {
  const t = useT();
  const { sessionWorkingDir } = useSessionMeta();
  const { showToast } = useUiStore();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const body = useCollapseAnimation<HTMLDivElement, HTMLDivElement>(open);
  const StatusIcon = STATUS_ICONS[task.status];
  const status =
    task.status === "unknown" ? task.rawStatus : t(`session.task.status.${task.status}`);
  const { usage } = task;
  const hasUsage =
    [usage.totalTokens, usage.toolUses, usage.contextPercent, usage.compactions].some(
      (value) => value !== null,
    ) ||
    (usage.estimatedCostUsd !== null && usage.estimatedCostUsd > 0);

  const copy = async (value: string): Promise<void> => {
    showToast(t((await copyTextToClipboard(value)) ? "common.copied" : "common.copyFailed"));
  };

  return (
    <section
      className={styles.notice}
      data-task-id={task.taskId}
      data-status={task.status}
      data-custom-type="subagent-notification"
    >
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <Robot size={16} weight="regular" aria-hidden="true" />
        <span className={styles.label}>
          {t(task.source === "workflow" ? "session.task.workflow" : "session.task.label")}
        </span>
        <span className={styles.title} title={task.title}>
          {task.title}
        </span>
        <span className={styles.state} role="img" aria-label={status} title={task.rawStatus}>
          <StatusIcon size={16} weight="regular" aria-hidden="true" />
        </span>
        {usage.durationMs !== null && (
          <span className={styles.duration} title={t("session.run.elapsedTitle")}>
            {formatElapsed(usage.durationMs)}
          </span>
        )}
        {open ? (
          <CaretDown size={16} weight="regular" aria-hidden="true" />
        ) : (
          <CaretRight size={16} weight="regular" aria-hidden="true" />
        )}
      </button>
      <div id={bodyId} className={styles.bodyWrap} ref={body.ref}>
        {body.rendered && (
          <div className={styles.body} ref={body.innerRef} data-selectable-text>
            <div className={styles.content}>
              <div className={styles.resultTools}>
                <h2 className={styles.heading}>{t("session.task.result")}</h2>
                <button
                  type="button"
                  className={styles.copyButton}
                  aria-label={t("session.task.copyResult")}
                  disabled={!task.rawResult}
                  onClick={() => void copy(task.rawResult)}
                >
                  <Copy size={16} weight="regular" aria-hidden="true" />
                  {t("common.copy")}
                </button>
              </div>
              {task.result ? (
                <MarkdownContent
                  text={task.result}
                  breaks
                  imageBaseDir={sessionWorkingDir}
                  imagePreview
                />
              ) : (
                <p className={styles.empty}>{t("session.task.noResult")}</p>
              )}
              {task.truncated && (
                <div className={styles.truncation}>
                  <Info size={16} weight="regular" aria-hidden="true" />
                  <span>
                    {t("session.task.truncated")}
                    {task.outputFile && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className={styles.textAction}
                          onClick={() => void copy(task.outputFile ?? "")}
                        >
                          {t("session.task.copyPath")}
                        </button>
                      </>
                    )}
                  </span>
                </div>
              )}
              {hasUsage && (
                <section className={styles.usage} aria-label={t("session.task.usage")}>
                  {usage.totalTokens !== null && (
                    <span className={styles.metric} title={`${usage.totalTokens} tokens`}>
                      <ChartBar size={16} weight="regular" aria-hidden="true" />
                      {formatTokens(usage.totalTokens)} tokens
                    </span>
                  )}
                  {usage.toolUses !== null && (
                    <span className={styles.metric}>
                      {t("session.task.toolUses", { count: usage.toolUses })}
                    </span>
                  )}
                  {usage.contextPercent !== null && (
                    <span className={styles.metric}>
                      {t("session.task.context", { value: usage.contextPercent })}
                    </span>
                  )}
                  {usage.compactions !== null && (
                    <span className={styles.metric}>
                      {t("session.task.compactions", { count: usage.compactions })}
                    </span>
                  )}
                  {usage.estimatedCostUsd !== null && usage.estimatedCostUsd > 0 && (
                    <span className={styles.metric}>{formatCost(usage.estimatedCostUsd)}</span>
                  )}
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
