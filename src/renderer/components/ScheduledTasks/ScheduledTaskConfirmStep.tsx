import { useT } from "../../hooks/useT";
import styles from "./ScheduledTasksPage.module.css";
import type { FormState } from "./scheduledTaskForm";

interface ScheduledTaskConfirmStepProps {
  form: FormState;
  ruleDesc: string;
}

/**
 * 「确认影响范围」步：把无人值守任务的目录、计划、运行方式与提示词复述成对照表，
 * 底部固定警告（docs 30 §6 验收项）。
 */
export function ScheduledTaskConfirmStep({ form, ruleDesc }: ScheduledTaskConfirmStepProps) {
  const t = useT();

  return (
    <div className={styles.confirmBody}>
      <p className={styles.confirmLead}>{t("scheduled.confirm.impact")}</p>
      <dl className={styles.impactList}>
        <div className={styles.impactItem}>
          <dt className={styles.impactLabel}>{t("scheduled.dialog.name")}</dt>
          <dd className={`${styles.impactValue} ${styles.impactValueStrong}`}>
            {form.name || t("scheduled.dialog.name.placeholder")}
          </dd>
        </div>
        <div className={styles.impactItem}>
          <dt className={styles.impactLabel}>{t("scheduled.dialog.cwd")}</dt>
          <dd className={styles.impactValue}>{form.cwd || "—"}</dd>
        </div>
        <div className={styles.impactItem}>
          <dt className={styles.impactLabel}>{t("scheduled.dialog.schedule")}</dt>
          <dd className={styles.impactValue}>{ruleDesc}</dd>
        </div>
        <div className={styles.impactItem}>
          <dt className={styles.impactLabel}>{t("scheduled.dialog.target")}</dt>
          <dd className={styles.impactValue}>
            {form.target === "bound"
              ? t("scheduled.confirm.target.bound")
              : t("scheduled.confirm.target.new")}
          </dd>
        </div>
        <div className={styles.impactItem}>
          <dt className={styles.impactLabel}>{t("scheduled.dialog.prompt")}</dt>
          <dd className={styles.impactValue}>{form.prompt || "—"}</dd>
        </div>
      </dl>
      <div className={styles.warning}>{t("scheduled.confirm.warning")}</div>
    </div>
  );
}
