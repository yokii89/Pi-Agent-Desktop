import { ArrowClockwise, StopCircle } from "@phosphor-icons/react";
import { useNowTick } from "../../hooks/useNowTick";
import { useT } from "../../hooks/useT";
import { useSessionMeta } from "../../stores/sessionStore";
import type { RunEntry } from "../../stores/sessionTranscript";
import { formatTokens } from "../../utils/formatTokens";
import { formatElapsed } from "../../utils/time";
import styles from "./AgentRunHeader.module.css";
import { PiStateMark } from "./PiStateMark";

function formatCost(total: number): string {
  if (total <= 0) return "";
  if (total < 0.01) return `$${total.toFixed(4)}`;
  return `$${total.toFixed(2)}`;
}

/**
 * 一次 agent run 的边界头：π 状态 + 本轮用时计时 + 停止/重试。
 * 工作目录由 SessionHeader 统一展示，这里不再重复。
 * 「重试」只挂在 findRetrySurfaceId 选出的终态落点上（中间 attempt 不带按钮）。
 */
export function AgentRunHeader({
  entry,
  showRetry = false,
}: {
  entry: RunEntry;
  /** 是否为当前轮唯一重试落点（由 SessionView 按 findRetrySurfaceId 注入）。 */
  showRetry?: boolean;
}) {
  const t = useT();
  const { stop, retryLastUserMessage, canRetryLastUser } = useSessionMeta();
  const running = entry.status === "running";
  const now = useNowTick(running);
  // 终态必须用 endedAt；缺失时退回 startedAt（显示 0s），绝不能拿挂载时刻当终点，
  // 否则历史 run 的用时会随重挂载无限增长
  const end = running ? now : (entry.endedAt ?? entry.startedAt);
  const elapsed = formatElapsed(end - entry.startedAt);
  const retryVisible = showRetry && !running && canRetryLastUser;

  const usage = entry.usage;
  const usageTitle = usage
    ? [
        t("session.run.usageInput", { value: usage.input }),
        t("session.run.usageOutput", { value: usage.output }),
        t("session.run.usageCacheRead", { value: usage.cacheRead }),
        t("session.run.usageCacheWrite", { value: usage.cacheWrite }),
        usage.cost ? t("session.run.usageCost", { value: `$${usage.cost.total}` }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const usageText =
    !running && usage
      ? [
          `${formatTokens(usage.totalTokens)} tokens`,
          usage.cost ? formatCost(usage.cost.total) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <div className={styles.run}>
      <PiStateMark status={entry.status} size={16} showLabel={entry.status !== "completed"} />
      <span className={styles.right}>
        {entry.retry && (
          <span className={styles.retry} title={entry.retry.errorMessage ?? undefined}>
            {t("session.run.autoRetry", {
              attempt: entry.retry.attempt,
              max: entry.retry.maxAttempts,
            })}
          </span>
        )}
        {!running && !entry.retry && entry.retryCount > 0 && entry.status === "failed" && (
          <span className={styles.retryFailed}>
            {t("session.run.retryFailed", { count: entry.retryCount })}
          </span>
        )}
        <span className={styles.elapsed} title={t("session.run.elapsedTitle")}>
          {elapsed}
        </span>
        {usageText && (
          <span className={styles.usage} title={usageTitle}>
            {usageText}
          </span>
        )}
        {running && !entry.synthetic && (
          <button type="button" className={styles.ghost} onClick={stop}>
            <StopCircle size={14} weight="regular" />
            {t("session.input.stop")}
          </button>
        )}
        {retryVisible && (
          <button
            type="button"
            className={styles.ghost}
            onClick={() => void retryLastUserMessage()}
          >
            <ArrowClockwise size={14} weight="regular" />
            {t("session.retry")}
          </button>
        )}
      </span>
    </div>
  );
}
