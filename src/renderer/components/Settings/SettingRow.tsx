import type { ReactNode } from "react";
import styles from "./Settings.module.css";

interface SettingRowProps {
  label: string;
  /** 补充说明（含阶段备注，如"M2 提供"）；可传 ReactNode 以附加醒目文案。 */
  description?: ReactNode;
  control: ReactNode;
}

/** 设置条目：左侧标签 + 说明，右侧控件。 */
export function SettingRow({ label, description, control }: SettingRowProps) {
  return (
    <div className={styles.row}>
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
