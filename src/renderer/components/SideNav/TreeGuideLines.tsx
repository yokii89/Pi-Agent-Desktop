import styles from "./SideNav.module.css";

/** 缩进层级的稳定标识：层级本身不会重排，用其编号作 key 是安全的。 */
const LEVEL_KEYS = ["l0", "l1", "l2", "l3", "l4"] as const;

interface TreeGuideLinesProps {
  /** 缩进层级：depth=0 只画一个分支钩，depth=n 画 n 条贯穿竖线 + 一个分支钩。 */
  depth: number;
  /** 当前行是否为其父层级的最后一项——最后一项的分支钩只画到一半。 */
  last: boolean;
}

/**
 * 项目子列表的树状引导线：用 1px 竖线表达层级，分支钩（└ 的横杠）指向当前条目，
 * 最后一项只画半截。纯装饰元素，整块随容器高度一起被裁切，无需自身动画。
 */
export function TreeGuideLines({ depth, last }: TreeGuideLinesProps) {
  return (
    <span className={styles.guide} aria-hidden="true">
      {LEVEL_KEYS.slice(0, Math.max(0, depth)).map((key) => (
        <span key={key} className={styles.guideLine} />
      ))}
      <span
        className={[styles.guideLine, last ? styles.guideBranchLast : styles.guideBranch].join(" ")}
      />
    </span>
  );
}
