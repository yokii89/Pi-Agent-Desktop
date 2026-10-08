import { X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { ScheduledTask, SchedulerTaskInput } from "../../../shared/scheduler";
import { sanitizeSchedulerTaskInput } from "../../../shared/scheduler";
import { useT } from "../../hooks/useT";
import { useSessionMeta } from "../../stores/sessionStore";
import { excludeArchivedSessions } from "../../utils/sessionGroups";
import { formatAbsoluteTime } from "../../utils/time";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { ScheduledTaskConfirmStep } from "./ScheduledTaskConfirmStep";
import { ScheduledTaskFormStep } from "./ScheduledTaskFormStep";
import styles from "./ScheduledTasksPage.module.css";
import { type FormState, formFromTask, ruleFromForm } from "./scheduledTaskForm";
import { describeScheduleRule, previewNextRun } from "./scheduleText";

interface ScheduledTaskDialogProps {
  open: boolean;
  /** 编辑目标；null = 新建。 */
  task: ScheduledTask | null;
  onClose: () => void;
  /** 已通过确认页的提交（store.createTask / updateTask）；抛错时留在确认页展示。 */
  onSubmit: (input: SchedulerTaskInput) => Promise<void>;
}

/**
 * 新建 / 编辑定时任务对话框：两步式——先填表单，再进「确认影响范围」页
 * （docs 30 §6 验收项：定时任务创建必须有显式二次确认并复述影响范围）。
 */
export function ScheduledTaskDialog({ open, task, onClose, onSubmit }: ScheduledTaskDialogProps) {
  const t = useT();
  const { allSessions, archivedFiles } = useSessionMeta();
  const [form, setForm] = useState<FormState>(() => formFromTask(task));
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 每次打开（含切换编辑目标）重置表单与步骤
  useEffect(() => {
    if (open) {
      setForm(formFromTask(task));
      setStep("form");
      setError(null);
    }
  }, [open, task]);

  const patch = (partial: Partial<FormState>): void => {
    setForm((prev) => {
      const next = { ...prev, ...partial };
      // 绑定会话按 cwd 过滤：换目录后旧绑定必然不在新列表里，清空避免存下跨目录的悬挂绑定
      if (partial.cwd !== undefined && partial.cwd !== prev.cwd && next.target === "bound") {
        next.sessionFile = "";
      }
      return next;
    });
    setError(null);
  };

  // 绑定目标限定未归档会话：归档 = 收起出主动工作集，不再作为定时执行对象；
  // 已绑定会话事后被归档不影响既有任务（调度按 file 直连执行）
  const boundSessions = useMemo(() => {
    const active = excludeArchivedSessions(allSessions, archivedFiles);
    if (!form.cwd) return active;
    return active.filter((session) => session.cwd === form.cwd);
  }, [allSessions, archivedFiles, form.cwd]);

  const rulePreview = useMemo(() => ruleFromForm(form), [form]);
  const nextPreview = useMemo(() => previewNextRun(rulePreview), [rulePreview]);

  /** 装配提交入参：enabled 透传编辑目标当前值，编辑停用任务不得被隐式重新启用。 */
  const buildInput = (): SchedulerTaskInput => ({
    name: form.name,
    prompt: form.prompt,
    cwd: form.cwd,
    sessionFile: form.sessionFile || null,
    rule: rulePreview,
    enabled: task?.enabled ?? true,
  });

  const goToConfirm = (): void => {
    if (form.target === "bound" && !form.sessionFile) {
      setError(t("scheduled.dialog.target.bound.required"));
      return;
    }
    try {
      sanitizeSchedulerTaskInput(buildInput());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setError(null);
    setStep("confirm");
  };

  const confirm = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(buildInput());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const ruleDesc = describeScheduleRule(t, rulePreview);
  const close = submitting ? () => {} : onClose;

  return (
    <Modal
      open={open}
      onClose={close}
      ariaLabel={task ? t("scheduled.dialog.edit.title") : t("scheduled.dialog.create.title")}
      panelClassName={styles.dialogPanel}
    >
      <div className={styles.dialogHeader}>
        <h2 className={styles.dialogTitle}>
          {task ? t("scheduled.dialog.edit.title") : t("scheduled.dialog.create.title")}
        </h2>
        <div className={styles.stepTabs}>
          <span
            className={[styles.stepTab, step === "form" ? styles.stepTabActive : ""].join(" ")}
            aria-current={step === "form" ? "step" : undefined}
          >
            <span className={styles.stepIndex}>1</span>
            {t("scheduled.dialog.step.form")}
          </span>
          <span className={styles.stepConnector} aria-hidden="true" />
          <span
            className={[styles.stepTab, step === "confirm" ? styles.stepTabActive : ""].join(" ")}
            aria-current={step === "confirm" ? "step" : undefined}
          >
            <span className={styles.stepIndex}>2</span>
            {t("scheduled.dialog.step.confirm")}
          </span>
        </div>
        <IconButton title={t("common.close")} onClick={close}>
          <X size={18} weight="regular" />
        </IconButton>
      </div>

      {step === "form" ? (
        <>
          <ScheduledTaskFormStep form={form} boundSessions={boundSessions} onPatch={patch} />
          <div className={styles.dialogFooter}>
            {error ? <div className={styles.dialogError}>{error}</div> : null}
            <div className={styles.footerRow}>
              <div className={styles.previewLine}>
                <span className={styles.previewLabel}>{t("scheduled.dialog.preview.label")}</span>
                <span className={styles.previewTime}>
                  {nextPreview !== null
                    ? formatAbsoluteTime(nextPreview)
                    : t("scheduled.dialog.preview.none")}
                </span>
              </div>
              <div className={styles.dialogActions}>
                <Button onClick={close} disabled={submitting}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" onClick={goToConfirm}>
                  {t("scheduled.dialog.next")}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <ScheduledTaskConfirmStep form={form} ruleDesc={ruleDesc} />
          <div className={styles.dialogFooter}>
            {error ? <div className={styles.dialogError}>{error}</div> : null}
            <div className={styles.footerRow}>
              <div className={styles.dialogActions}>
                <Button onClick={() => setStep("form")} disabled={submitting}>
                  {t("scheduled.dialog.back")}
                </Button>
                <Button variant="primary" onClick={() => void confirm()} disabled={submitting}>
                  {task ? t("scheduled.dialog.submit.save") : t("scheduled.dialog.submit.create")}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
