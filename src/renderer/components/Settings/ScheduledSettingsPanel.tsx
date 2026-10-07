import { Timer } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useT } from "../../hooks/useT";
import { useSchedulerStore } from "../../stores/schedulerStore";
import { useUiStore } from "../../stores/uiStore";
import { formatNextRunTime } from "../ScheduledTasks/scheduleText";
import { Button } from "../ui/Button";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";

/**
 * 设置 → 定时任务：概览 + 打开管理页。
 * 管理面在中央路由的定时任务页，这里只做状态可见性与入口（避免两处维护表单）。
 */
export function ScheduledSettingsPanel() {
  const t = useT();
  const { tasks, loaded } = useSchedulerStore();
  const { navigate, closeSettings } = useUiStore();

  const summary = useMemo(() => {
    const enabledCount = tasks.filter((task) => task.enabled).length;
    const nextTimes = tasks
      .filter((task) => task.enabled && task.nextRunAt !== null)
      .map((task) => task.nextRunAt as number)
      .sort((a, b) => a - b);
    const next = formatNextRunTime(nextTimes[0] ?? null);
    if (tasks.length === 0) return t("scheduled.settings.summary.none");
    if (next === null)
      return t("scheduled.settings.summary.next.none", { n: tasks.length, m: enabledCount });
    return t("scheduled.settings.summary.next", { n: tasks.length, m: enabledCount, time: next });
  }, [t, tasks]);

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.scheduled")}</h2>
      <SettingsSection title={t("settings.section.scheduled")}>
        <SettingRow
          label={t("scheduled.title")}
          description={summary}
          control={<span className={styles.valueText}>{loaded ? tasks.length : "…"}</span>}
        />
        <SettingRow
          label={t("scheduled.settings.open")}
          description={t("scheduled.subtitle")}
          control={
            <Button
              onClick={() => {
                closeSettings();
                navigate("scheduled");
              }}
            >
              <Timer size={16} weight="regular" /> {t("scheduled.settings.open")}
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
