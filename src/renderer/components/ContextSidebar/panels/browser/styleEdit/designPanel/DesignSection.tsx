import type { ReactNode } from "react";
import styles from "./designPanel.module.css";

/**
 * 设计面板分组：加重标题 + 右侧描边动作钮 + 内容。
 */

export interface DesignSectionProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function DesignSection({ title, actions, children }: DesignSectionProps) {
  return (
    <section className={styles.section} aria-label={title}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
