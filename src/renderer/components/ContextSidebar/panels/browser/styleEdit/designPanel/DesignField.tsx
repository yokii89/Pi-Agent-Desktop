import type { ReactNode } from "react";
import styles from "./designPanel.module.css";

/**
 * 设计面板字段：左标签 + 右控件，或标签独占一行（block）。
 * short 给 X/Y/Z/W/H；autoLabel 给 Flow / 字体等弹性标签。
 */

export interface DesignFieldProps {
  label: string;
  /** 标签是否单独占行（长复合值等）。 */
  block?: boolean;
  /** 左标签收窄（X / Y / W…）。 */
  short?: boolean;
  /** 标签宽度随内容。 */
  autoLabel?: boolean;
  children: ReactNode;
  hint?: string;
}

export function DesignField({ label, block, short, autoLabel, children, hint }: DesignFieldProps) {
  const labelClass = block
    ? styles.fieldBlockLabel
    : [
        styles.fieldLabel,
        short ? styles.fieldLabelShort : "",
        autoLabel ? styles.fieldLabelAuto : "",
      ]
        .filter(Boolean)
        .join(" ");
  return (
    <div className={block ? styles.fieldBlock : styles.fieldRow} title={hint}>
      <span className={labelClass}>{label}</span>
      <div className={styles.fieldControl}>{children}</div>
    </div>
  );
}

/** 紧凑单行：可选短标签 + 多个控件 + 可选尾部动作。 */
export function DenseRow({
  label,
  children,
  action,
}: {
  label?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.denseRow}>
      {label ? <span className={styles.denseLabel}>{label}</span> : null}
      {children}
      {action}
    </div>
  );
}

/** 一行两列（W/H、透明/圆角…）。 */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className={styles.fieldPair}>{children}</div>;
}

/** 一行三列（X/Y/Z）。 */
export function FieldTriple({ children }: { children: ReactNode }) {
  return <div className={styles.fieldTriple}>{children}</div>;
}
