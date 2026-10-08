import { useT } from "../../hooks/useT";
import styles from "./PiStateMark.module.css";

export type PiRunStatus = "running" | "completed" | "failed" | "interrupted";

const STATUS_CLASS: Record<PiRunStatus, string> = {
  running: styles.isRunning,
  completed: styles.isCompleted,
  failed: styles.isFailed,
  interrupted: styles.isInterrupted,
};

const STATUS_LABEL_KEY: Record<PiRunStatus, string> = {
  running: "session.piState.running",
  completed: "session.piState.completed",
  failed: "session.piState.failed",
  interrupted: "session.piState.interrupted",
};

interface PiStateMarkProps {
  status: PiRunStatus;
  /** 像素尺寸；默认 18（行内）。小于 18 时建议只显示文字标签。 */
  size?: number;
  /** 是否展示状态文字（与 π 同族着色）。 */
  showLabel?: boolean;
  label?: string;
}

/**
 * π 四态标识（v3）：同一份 SVG 常驻，只切换 is-* 类，
 * 笔触走 currentColor，映射 tokens 的 accent/success/danger/warning。
 */
export function PiStateMark({ status, size = 18, showLabel = true, label }: PiStateMarkProps) {
  const t = useT();
  const compact = size <= 20;
  return (
    <span className={`${styles.state} ${STATUS_CLASS[status]}`} data-status={status}>
      <span
        className={`${styles.mark} ${compact ? styles.compact : ""}`}
        style={{ "--size": `${size}px` } as React.CSSProperties}
        aria-hidden="true"
      >
        <svg
          className={styles.svg}
          viewBox="0 0 80 80"
          xmlns="http://www.w3.org/2000/svg"
          focusable="false"
        >
          <title>π</title>
          {/* 运行中：低亮轮廓 + 三段循环流动 */}
          <g className={`${styles.layer} ${styles.running}`}>
            <g className={`${styles.line} ${styles.ghost}`}>
              <path d="M19 29 Q23 23 31 24 H61" />
              <path d="M31 24 C31 38 29 49 24 58" />
              <path d="M51 24 L48.5 49 Q47 61 59 55" />
            </g>
            <g className={styles.line}>
              <path className={styles.flow} pathLength="1" d="M19 29 Q23 23 31 24 H61" />
              <path
                className={`${styles.flow} ${styles.flowLeft}`}
                pathLength="1"
                d="M31 24 C31 38 29 49 24 58"
              />
              <path
                className={`${styles.flow} ${styles.flowRight}`}
                pathLength="1"
                d="M51 24 L48.5 49 Q47 61 59 55"
              />
            </g>
          </g>

          {/* 已完成：收束 + 一次性光环 */}
          <g className={`${styles.layer} ${styles.completed}`}>
            <circle className={styles.halo} cx="40" cy="40" r="31" pathLength="1" />
            <g className={styles.line}>
              <path className={styles.draw} pathLength="1" d="M19 29 Q23 23 31 24 H61" />
              <path className={styles.draw} pathLength="1" d="M31 24 C31 38 29 49 24 58" />
              <path className={styles.draw} pathLength="1" d="M51 24 L48.5 49 Q47 61 59 55" />
            </g>
          </g>

          {/* 失败：横笔断口 + 右支脚失配 */}
          <g className={`${styles.layer} ${styles.failed}`}>
            <g className={styles.line}>
              <path className={styles.draw} pathLength="1" d="M19 29 Q23 23 31 24 H42" />
              <path className={styles.draw} pathLength="1" d="M50 24 H61" />
              <path className={styles.draw} pathLength="1" d="M31 24 C31 38 29 49 24 58" />
              <g className={styles.failedLeg}>
                <path className={styles.draw} pathLength="1" d="M51 32 L48.5 49 Q47 61 59 55" />
              </g>
            </g>
          </g>

          {/* 已中断：π 轮廓记忆 + 暂停双线 */}
          <g className={`${styles.layer} ${styles.interrupted}`}>
            <g className={styles.line}>
              <path className={styles.pauseMemory} pathLength="1" d="M19 29 Q23 23 31 24 H61" />
              <path className={styles.pauseMemory} pathLength="1" d="M31 24 C31 38 29 49 24 58" />
              <path
                className={styles.pauseMemory}
                pathLength="1"
                d="M51 24 L48.5 49 Q47 61 59 55"
              />
              <path
                className={`${styles.draw} ${styles.pauseBars}`}
                pathLength="1"
                d="M31 33 V55"
              />
              <path
                className={`${styles.draw} ${styles.pauseBars}`}
                pathLength="1"
                d="M50 33 V55"
              />
            </g>
          </g>
        </svg>
      </span>
      {showLabel && <span className={styles.label}>{label ?? t(STATUS_LABEL_KEY[status])}</span>}
    </span>
  );
}
