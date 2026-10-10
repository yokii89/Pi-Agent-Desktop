import styles from "./SideNav.module.css";

/** 3×3 点阵的固定键（静态表避免 array index key；顺序即 DOM 顺序）。 */
const DOTS = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"] as const;

/**
 * 会话进行中的点阵指示（设计图 4）：3×3 方点按对角线相位呼吸（CSS 动画，
 * 相位差在样式表里用 nth-child 写死）；减少动效时静止为常量点阵。
 * 尺寸/颜色继承父级状态槽（见 SideNav.module.css .runningDots）。
 */
export function RunningDots() {
  return (
    <span className={styles.runningDots} aria-hidden="true">
      {DOTS.map((dot) => (
        <span key={dot} className={styles.runningDot} />
      ))}
    </span>
  );
}
