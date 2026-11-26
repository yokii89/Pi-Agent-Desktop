import type { ManagedSkillPlan } from "../../../shared/managedSkills";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { ManagedSkillDiagnostics } from "./ManagedSkillDiagnostics";
import styles from "./ManagedSkillsSection.module.css";

export function ManagedSkillPlanDialog({
  plan,
  busy,
  onCancel,
  onConfirm,
}: {
  plan: ManagedSkillPlan | null;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const t = useT();
  return (
    <Modal
      open={plan !== null}
      onClose={() => {
        if (!busy) onCancel();
      }}
      ariaLabel={t("skills.plan.title")}
      panelClassName={styles.dialog}
    >
      {plan ? (
        <>
          <h2 className={styles.title}>
            {t(`skills.operation.${plan.operation}`)} · {plan.name}
          </h2>
          <p className={styles.note}>{t("skills.plan.note")}</p>
          <code className={styles.path} data-selectable-text>
            {plan.target}
          </code>
          {plan.preservesFiles ? <p className={styles.warning}>{t("skills.preserve")}</p> : null}
          <ManagedSkillDiagnostics diagnostics={plan.diagnostics} />
          <ul className={styles.files} data-selectable-text>
            {plan.files.map((file) => (
              <li key={file.path}>
                <span>{t(`skills.change.${file.change}`)}</span>
                <code>{file.path}</code>
              </li>
            ))}
          </ul>
          {!plan.canApply ? <p className={styles.error}>{t("skills.plan.blocked")}</p> : null}
          <div className={styles.actions}>
            <Button disabled={busy} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={busy || !plan.canApply}
              variant={plan.operation === "uninstall" ? "danger" : "primary"}
              onClick={onConfirm}
            >
              {busy ? t("skills.working") : t("common.confirm")}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
