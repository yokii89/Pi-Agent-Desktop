import type { ReactNode } from "react";
import styles from "./Settings.module.css";

interface SettingRowProps {
  label: string;
  /** 补充说明（含阶段备注，如"M2 提供"）；可传 ReactNode 以附加醒目文案。 */
  description?: ReactNode;
  control: ReactNode;
  /**
   * 控件换到下一行、占满整行。给「一排会随选项增多而变宽」的缩略图组用
   * （如伙伴形象）：贴在右侧控件列会挤掉说明文案。
   */
  stack?: boolean;
}

/** 设置条目：左侧标签 + 说明，右侧控件（`stack` 时控件另起一行）。 */
export function SettingRow({ label, description, control, stack }: SettingRowProps) {
  return (
    <div className={stack ? `${styles.row} ${styles.rowStacked}` : styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {description && <span className={styles.rowDescription}>{description}</span>}
      </div>
      <div className={styles.rowControl}>{control}</div>
    </div>
  );
}

/** 设置分组卡片；`title` 省略时不渲染标题行（如热力图区，标题由布局本身表达）。 */
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      {title ? <h2 className={styles.sectionTitle}>{title}</h2> : null}
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
