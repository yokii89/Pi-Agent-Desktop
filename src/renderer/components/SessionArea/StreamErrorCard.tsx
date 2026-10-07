import { ArrowClockwise } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import { useSessionMeta } from "../../stores/sessionStore";
import type { ErrorEntry } from "../../stores/sessionTranscript";
import styles from "./StreamErrorCard.module.css";

/**
 * 会话流内错误提示：LLM 调用失败 / 进程异常 / 压缩失败。
 * 纯文字：标题与详情同一段内联流，无底色/边框卡片壳。
 * 内联「重试」与 run 头重试调同一 retryLastUserMessage（docs/design/13 P1-6，
 * 同语义入口原则 docs/design/11 §9，不产生第二套文案）。
 * 只挂在 findRetrySurfaceId 选出的终态落点上，避免每条失败各带一个按钮。
 */
export function StreamErrorCard({
  entry,
  showRetry = false,
}: {
  entry: ErrorEntry;
  /** 是否为当前轮唯一重试落点（由 SessionView 按 findRetrySurfaceId 注入）。 */
  showRetry?: boolean;
}) {
  const t = useT();
  const { canRetryLastUser, retryLastUserMessage } = useSessionMeta();
  const retryVisible = showRetry && canRetryLastUser;
  return (
    <aside className={styles.card} role="alert">
      <div className={styles.body}>
        <span className={styles.title}>
          {entry.errorKey === "llm"
            ? t("session.error.llm")
            : entry.errorKey === "aborted"
              ? t("session.error.aborted")
              : entry.errorKey === "length"
                ? t("session.error.length")
                : entry.errorKey === "process"
                  ? t("session.error.processTitle")
                  : entry.errorKey === "compact"
                    ? entry.title
                    : entry.title}
        </span>
        {entry.message ? <span className={styles.message}>{entry.message}</span> : null}
        {retryVisible && (
          <button
            type="button"
            className={styles.retry}
            title={t("session.retryLastMessage")}
            onClick={() => void retryLastUserMessage()}
          >
            <ArrowClockwise size={14} weight="regular" />
            {t("session.retry")}
          </button>
        )}
      </div>
    </aside>
  );
}
