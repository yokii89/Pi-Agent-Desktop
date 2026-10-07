import {
  ChatCircleDots,
  ClipboardText,
  Clock,
  FolderOpen,
  NotePencil,
  Plus,
} from "@phosphor-icons/react";
import type { SessionSummary } from "../../../shared/ipc";
import { SCHEDULER_INTERVAL_MAX_MINUTES } from "../../../shared/scheduler";
import { useT } from "../../hooks/useT";
import { projectService } from "../../services/projectService";
import { useProjectStore } from "../../stores/projectStore";
import { Button } from "../ui/Button";
import styles from "./ScheduledTasksPage.module.css";
import { ALL_WEEKDAYS, type FormState, type ModeId, type TargetId } from "./scheduledTaskForm";

interface ScheduledTaskFormStepProps {
  form: FormState;
  boundSessions: SessionSummary[];
  onPatch: (partial: Partial<FormState>) => void;
}

/**
 * 新建/编辑定时任务的「填写」步：按基本信息 / 触发计划 / 运行方式 / 提示词分区，
 * 标签一律在控件上方；调度参数与单位同排，避免「控件在前标签在后」的倒序阅读。
 */
export function ScheduledTaskFormStep({
  form,
  boundSessions,
  onPatch,
}: ScheduledTaskFormStepProps) {
  const t = useT();
  const { projects, addProjectByPicker } = useProjectStore();

  const browseCwd = async (): Promise<void> => {
    const dir = await projectService.pickDirectory();
    if (dir) onPatch({ cwd: dir });
  };

  const addProjectAndUse = async (): Promise<void> => {
    const project = await addProjectByPicker();
    if (project) onPatch({ cwd: project.dir });
  };

  return (
    <div className={styles.formBody}>
      <section className={styles.formSection}>
        <h3 className={styles.sectionTitle}>
          <ClipboardText size={16} weight="regular" className={styles.sectionIcon} />
          {t("scheduled.dialog.section.basic")}
        </h3>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="scheduled-task-name">
            {t("scheduled.dialog.name")}
          </label>
          <input
            id="scheduled-task-name"
            className={styles.textInput}
            value={form.name}
            placeholder={t("scheduled.dialog.name.placeholder")}
            maxLength={80}
            onChange={(event) => onPatch({ name: event.target.value })}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel} id="scheduled-task-cwd-label">
            {t("scheduled.dialog.cwd")}
          </span>
          <div className={styles.rowInline}>
            <select
              className={`${styles.selectInput} ${styles.grow}`}
              value={form.cwd}
              aria-labelledby="scheduled-task-cwd-label"
              onChange={(event) => onPatch({ cwd: event.target.value })}
            >
              <option value="">—</option>
              {projects.map((project) => (
                <option key={project.id} value={project.dir}>
                  {project.name}
                </option>
              ))}
              {form.cwd && !projects.some((project) => project.dir === form.cwd) ? (
                <option value={form.cwd}>{form.cwd}</option>
              ) : null}
            </select>
            <Button onClick={() => void browseCwd()}>
              <FolderOpen size={16} weight="regular" />
              {t("scheduled.dialog.cwd.browse")}
            </Button>
            <Button onClick={() => void addProjectAndUse()}>
              <Plus size={16} weight="regular" />
              {t("sidenav.projects.add")}
            </Button>
          </div>
          <span className={styles.fieldDescription}>{t("scheduled.dialog.cwd.description")}</span>
        </div>
      </section>

      <section className={styles.formSection}>
        <h3 className={styles.sectionTitle}>
          <Clock size={16} weight="regular" className={styles.sectionIcon} />
          {t("scheduled.dialog.schedule")}
        </h3>

        <div
          className={styles.segmented}
          role="tablist"
          aria-label={t("scheduled.dialog.schedule")}
        >
          {(["interval", "daily", "once"] as ModeId[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={form.mode === mode}
              className={[styles.segment, form.mode === mode ? styles.segmentActive : ""].join(" ")}
              onClick={() => onPatch({ mode })}
            >
              {mode === "interval"
                ? t("scheduled.dialog.schedule.interval")
                : mode === "daily"
                  ? t("scheduled.dialog.schedule.daily")
                  : t("scheduled.dialog.schedule.once")}
            </button>
          ))}
        </div>

        {form.mode === "interval" ? (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="scheduled-task-interval">
              {t("scheduled.dialog.intervalMinutes")}
            </label>
            <div className={styles.paramRow}>
              <input
                id="scheduled-task-interval"
                className={`${styles.textInput} ${styles.paramInput}`}
                type="number"
                min={1}
                max={SCHEDULER_INTERVAL_MAX_MINUTES}
                value={form.intervalMinutes}
                onChange={(event) => onPatch({ intervalMinutes: event.target.value })}
              />
              <span className={styles.unitSuffix}>{t("scheduled.dialog.unit.minutes")}</span>
            </div>
          </div>
        ) : null}

        {form.mode === "daily" ? (
          <>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="scheduled-task-daily-time">
                {t("scheduled.dialog.dailyTime")}
              </label>
              <input
                id="scheduled-task-daily-time"
                className={`${styles.textInput} ${styles.paramInput}`}
                type="time"
                value={form.dailyTime}
                onChange={(event) => onPatch({ dailyTime: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t("scheduled.dialog.weekdays")}</span>
              <div className={styles.weekdayRow}>
                {ALL_WEEKDAYS.map((day) => {
                  const active = form.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      className={[styles.weekdayChip, active ? styles.weekdayChipActive : ""].join(
                        " ",
                      )}
                      onClick={() =>
                        onPatch({
                          weekdays: active
                            ? form.weekdays.filter((item) => item !== day)
                            : [...form.weekdays, day].sort((a, b) => a - b),
                        })
                      }
                    >
                      {t(`scheduled.weekday.${day}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        {form.mode === "once" ? (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="scheduled-task-once">
              {t("scheduled.dialog.onceAt")}
            </label>
            <input
              id="scheduled-task-once"
              className={`${styles.textInput} ${styles.paramInput}`}
              type="datetime-local"
              value={form.onceValue}
              onChange={(event) => onPatch({ onceValue: event.target.value })}
            />
          </div>
        ) : null}
      </section>

      <section className={styles.formSection}>
        <h3 className={styles.sectionTitle}>
          <ChatCircleDots size={16} weight="regular" className={styles.sectionIcon} />
          {t("scheduled.dialog.target")}
        </h3>

        <div className={styles.segmented}>
          {(["new", "bound"] as TargetId[]).map((target) => (
            <button
              key={target}
              type="button"
              aria-pressed={form.target === target}
              className={[styles.segment, form.target === target ? styles.segmentActive : ""].join(
                " ",
              )}
              onClick={() =>
                onPatch(target === "new" ? { target: "new", sessionFile: "" } : { target: "bound" })
              }
            >
              {target === "new"
                ? t("scheduled.dialog.target.new")
                : t("scheduled.dialog.target.bound")}
            </button>
          ))}
        </div>

        {form.target === "new" ? (
          <span className={styles.fieldDescription}>
            {t("scheduled.dialog.target.new.description")}
          </span>
        ) : (
          <div className={styles.field}>
            <select
              className={styles.selectInput}
              aria-label={t("scheduled.dialog.target.pick")}
              value={form.sessionFile}
              onChange={(event) => onPatch({ sessionFile: event.target.value })}
            >
              <option value="">{t("scheduled.dialog.target.pick")}</option>
              {boundSessions.map((session) => (
                <option key={session.file} value={session.file}>
                  {(session.firstUserMessage ?? session.file).slice(0, 60)}
                </option>
              ))}
            </select>
            <span className={styles.fieldDescription}>
              {t("scheduled.dialog.target.bound.description")}
            </span>
          </div>
        )}
      </section>

      <section className={styles.formSection}>
        <h3 className={styles.sectionTitle}>
          <NotePencil size={16} weight="regular" className={styles.sectionIcon} />
          {t("scheduled.dialog.prompt")}
        </h3>
        <div className={styles.field}>
          <textarea
            id="scheduled-task-prompt"
            className={styles.promptInput}
            value={form.prompt}
            placeholder={t("scheduled.dialog.prompt.placeholder")}
            onChange={(event) => onPatch({ prompt: event.target.value })}
          />
          <span className={styles.fieldDescription}>{t("scheduled.dialog.prompt.hint")}</span>
        </div>
      </section>
    </div>
  );
}
