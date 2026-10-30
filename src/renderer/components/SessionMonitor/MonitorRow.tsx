import type { ReactNode } from "react";
import styles from "./SessionMonitor.module.css";

interface MonitorRowProps {
  /** Phosphor 图标（16 档）；颜色由图标槽继承，不单独指定。 */
  icon: ReactNode;
  text: ReactNode;
  /** 悬停查看完整值（被截断的路径 / 命令行 / 网址）。 */
  title?: string;
  trailing?: ReactNode;
  tone?: "default" | "muted";
  /** 整行可点击时的动作（行内容包成按钮，保留列表语义）。 */
  onActivate?: () => void;
  /** 可点击行的可访问名称（按钮的 aria-label，需含动作与对象）。 */
  actionLabel?: string;
}

/** 监控卡的一行：图标槽 + 主文本（可截断）+ 右缘附属信息。 */
export function MonitorRow({
  icon,
  text,
  title,
  trailing,
  tone = "default",
  onActivate,
  actionLabel,
}: MonitorRowProps) {
  const content = (
    <>
      <span className={styles.iconTile} aria-hidden="true">
        {icon}
      </span>
      <span
        className={[styles.rowText, tone === "muted" ? styles.rowTextMuted : ""]
          .filter(Boolean)
          .join(" ")}
        title={title}
      >
        {text}
      </span>
      {trailing ? <span className={styles.rowTrailing}>{trailing}</span> : null}
    </>
  );
  return (
    <li className={[styles.row, onActivate ? styles.rowActionable : ""].filter(Boolean).join(" ")}>
      {onActivate ? (
        <button
          type="button"
          className={styles.rowAction}
          aria-label={actionLabel}
          onClick={onActivate}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
}

interface MonitorSectionProps {
  title: string;
  /** 标题右缘的提示徽章（如 MCP 配置待重载）。 */
  badge?: ReactNode;
  children: ReactNode;
}

/**
 * 监控卡的一个分区。空分区由调用方先行过滤（这里不做"子节点计数"判断：
 * 真实场景里判断依据是数据行数，不是渲染出来的 DOM）。
 */
export function MonitorSection({ title, badge, children }: MonitorSectionProps) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {badge ? <span className={styles.badge}>{badge}</span> : null}
      </header>
      <ul className={styles.rows}>{children}</ul>
    </section>
  );
}
