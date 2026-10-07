import { ArrowDown } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import styles from "./ScrollToBottomButton.module.css";

/**
 * 流式输出时用户已上滚：出现「跳到最新」，不强制拉回。
 * label 为未读提示（新 N 条 / +N 行，docs/design/13 P1-2），无未读时仅箭头。
 */
export function ScrollToBottomButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const t = useT();
  const ariaSuffix = label ? t("session.scrollToBottom.ariaSuffix", { label }) : "";
  return (
    <button
      type="button"
      className={styles.jump}
      title={t("session.scrollToBottom.title")}
      aria-label={t("session.scrollToBottom.aria", { suffix: ariaSuffix })}
      onClick={onClick}
    >
      <ArrowDown size={16} weight="regular" />
      {label && <span className={styles.label}>{label}</span>}
    </button>
  );
}
