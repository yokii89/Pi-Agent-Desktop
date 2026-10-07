import { GitCommit, Minus, Plus, UploadSimple } from "@phosphor-icons/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import { useT } from "../../hooks/useT";
import styles from "./CommitBar.module.css";

interface CommitBarProps {
  message: string;
  writing: boolean;
  stagedCount: number;
  canStageAll: boolean;
  canUnstageAll: boolean;
  onMessageChange: (message: string) => void;
  onCommitKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onCommit: () => void;
  onPush: () => void;
}

/** 浮窗底部提交栏：自动增高的提交信息输入 + 辅助动作行 + 提交/推送。 */
export function CommitBar({
  message,
  writing,
  stagedCount,
  canStageAll,
  canUnstageAll,
  onMessageChange,
  onCommitKeyDown,
  onStageAll,
  onUnstageAll,
  onCommit,
  onPush,
}: CommitBarProps) {
  const t = useT();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动增高：随内容撑开，封顶 120px 后内部滚动
  // biome-ignore lint/correctness/useExhaustiveDependencies: message 是重算高度的触发信号，effect 体只写样式不读它
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [message]);

  return (
    <div className={styles.bar}>
      <textarea
        ref={inputRef}
        className={styles.input}
        rows={1}
        value={message}
        placeholder={t("panels.review.commitPlaceholder")}
        disabled={writing}
        onChange={(event) => onMessageChange(event.target.value)}
        onKeyDown={onCommitKeyDown}
      />
      <div className={styles.row}>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={writing || !canStageAll}
          title={t("panels.review.stageAll")}
          aria-label={t("panels.review.stageAll")}
          onClick={onStageAll}
        >
          <Plus size={13} weight="bold" />
          <span className={styles.btnText}>{t("panels.review.stageAll")}</span>
        </button>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={writing || !canUnstageAll}
          title={t("panels.review.unstageAll")}
          aria-label={t("panels.review.unstageAll")}
          onClick={onUnstageAll}
        >
          <Minus size={13} weight="bold" />
          <span className={styles.btnText}>{t("panels.review.unstageAll")}</span>
        </button>
        <span className={styles.spacer} />
        <span className={styles.summary}>
          {t("panels.review.stagedSummary", { count: stagedCount })}
        </span>
        <button
          type="button"
          className={styles.commitBtn}
          disabled={writing || stagedCount === 0}
          title={t("panels.review.commit")}
          aria-label={t("panels.review.commit")}
          onClick={onCommit}
        >
          <GitCommit size={14} weight="regular" />
          <span className={styles.btnText}>
            {writing ? t("panels.review.committing") : t("panels.review.commit")}
          </span>
        </button>
        <button
          type="button"
          className={styles.pushBtn}
          disabled={writing}
          title={t("panels.review.push")}
          aria-label={t("panels.review.push")}
          onClick={onPush}
        >
          <UploadSimple size={14} weight="regular" />
          <span className={styles.btnText}>{t("panels.review.push")}</span>
        </button>
      </div>
    </div>
  );
}
