import { CheckCircle, PushPin, Question, WarningCircle } from "@phosphor-icons/react";
import type { SessionAttentionKind } from "../../stores/sessionBuckets";
import { RunningDots } from "./RunningDots";
import styles from "./SideNav.module.css";

/** 状态槽是 24px 盒：图标 18px 留出与 ⋯ 相近的边距（docs/design/82）。 */
const STATUS_ICON_SIZE = 18;

interface HistoryStatusSlotProps {
  /** AI 输出中 / 正在打开：3×3 点阵。 */
  busy: boolean;
  /** 扩展表单在等用户作答（仅未聚焦时传入 true）。 */
  awaiting: boolean;
  /** 收口后的待读标记（仅未聚焦时传入）；null = 无。 */
  attention: SessionAttentionKind | null;
  pinned: boolean;
  /** 状态槽的悬浮提示。 */
  title: string;
}

/**
 * 会话行右缘状态槽（docs/design/45 / 82）：同一时刻只表达一个状态，
 * 与 ⋯ 同位叠加，悬浮时由行 CSS 让位。
 */
export function HistoryStatusSlot({
  busy,
  awaiting,
  attention,
  pinned,
  title,
}: HistoryStatusSlotProps) {
  if (!busy && !awaiting && !attention && !pinned) return null;
  return (
    <span className={styles.statusLayer} data-session-status="" title={title}>
      {busy ? (
        <RunningDots />
      ) : awaiting ? (
        <Question size={STATUS_ICON_SIZE} weight="fill" className={styles.statusIconAwaiting} />
      ) : attention === "done" ? (
        <CheckCircle size={STATUS_ICON_SIZE} weight="fill" className={styles.statusIconDone} />
      ) : attention === "error" ? (
        <WarningCircle size={STATUS_ICON_SIZE} weight="fill" className={styles.statusIconError} />
      ) : attention === "unread" ? (
        <span className={styles.doneDot} />
      ) : (
        <PushPin size={16} weight="fill" />
      )}
    </span>
  );
}
