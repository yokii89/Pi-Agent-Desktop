import {
  Clock,
  DotsThreeVertical,
  PencilSimple,
  Play,
  TrashSimple,
  Tray,
} from "@phosphor-icons/react";
import type { ScheduledRunRecord, ScheduledTask } from "../../../shared/scheduler";
import { useT } from "../../hooks/useT";
import { formatShortRelativeTime } from "../../utils/time";
import { IconButton } from "../ui/IconButton";
import { Menu, type MenuItem } from "../ui/Menu";
import { Toggle } from "../ui/Toggle";
import styles from "./ScheduledTasksPage.module.css";
import { describeScheduleRule, formatNextRunTime } from "./scheduleText";

interface ScheduledTaskRowProps {
  task: ScheduledTask;
  /** 该任务最近一条「错过补跑」记录；存在且带 missedCount 时显示补跑徽标。 */
  latestCatchUp: ScheduledRunRecord | null;
  busy?: boolean;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
}

/**
 * 单个定时任务卡片：状态 + 名称 + 提示词预览 + 调度摘要 + 启停与操作菜单。
 * 卡片而非表格行——任务数少（上限 50），卡片能容纳两行元信息不换页。
 */
export function ScheduledTaskRow({
  task,
  latestCatchUp,
  busy,
  onToggle,
  onRunNow,
  onEdit,
  onHistory,
  onDelete,
}: ScheduledTaskRowProps) {
  const t = useT();
  const nextRun = formatNextRunTime(task.nextRunAt);
  const nextRunLabel = !task.enabled
    ? t("scheduled.row.disabled")
    : nextRun
      ? t("scheduled.row.nextRun", { time: nextRun })
      : task.rule.kind === "once"
        ? t("scheduled.row.noNextRun")
        : t("scheduled.row.nextRun.overdue");
  const lastRunLabel =
    task.lastRunAt !== null
      ? t("scheduled.row.lastRun", { time: formatShortRelativeTime(task.lastRunAt) })
      : null;

  const menuItems: MenuItem[] = [
    {
      key: "runNow",
      label: t("scheduled.row.menu.runNow"),
      icon: <Play size={16} weight="regular" />,
      onSelect: onRunNow,
    },
    {
      key: "history",
      label: t("scheduled.row.menu.history"),
      icon: <Tray size={16} weight="regular" />,
      onSelect: onHistory,
    },
    {
      key: "edit",
      label: t("scheduled.row.menu.edit"),
      icon: <PencilSimple size={16} weight="regular" />,
      onSelect: onEdit,
    },
    {
      key: "delete",
      label: t("scheduled.row.menu.delete"),
      icon: <TrashSimple size={16} weight="regular" />,
      tone: "danger",
      onSelect: onDelete,
    },
  ];

  return (
    <div
      className={[styles.taskCard, task.enabled ? "" : styles.taskCardDisabled].join(" ").trim()}
    >
      <div className={styles.taskMain}>
        <div className={styles.taskTitleRow}>
          <span className={styles.taskName} title={task.name}>
            {task.name}
          </span>
          {latestCatchUp?.missedCount ? (
            <span className={styles.missedBadge}>
              {t("scheduled.row.missedBadge", { n: latestCatchUp.missedCount })}
            </span>
          ) : null}
        </div>
        <div className={styles.taskPrompt} title={task.prompt}>
          {task.prompt}
        </div>
        <div className={styles.taskMeta}>
          <span className={styles.metaItem} title={task.cwd}>
            <Clock size={14} weight="regular" className={styles.scheduleIcon} />
            {describeScheduleRule(t, task.rule)}
          </span>
          <span className={styles.metaItem}>{nextRunLabel}</span>
          {lastRunLabel ? <span className={styles.metaItem}>{lastRunLabel}</span> : null}
          <span className={styles.metaItem}>{t("scheduled.row.ran", { n: task.runCount })}</span>
          {task.skipCount > 0 ? (
            <span className={styles.metaItem}>
              {t("scheduled.row.skipped", { n: task.skipCount })}
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles.taskSide}>
        <Toggle
          checked={task.enabled}
          disabled={busy}
          aria-label={`${task.name}`}
          onChange={() => onToggle(!task.enabled)}
        />
        <Menu
          trigger={({ onClick }) => (
            <IconButton title={t("sidenav.row.moreActions")} onClick={onClick}>
              <DotsThreeVertical size={16} weight="regular" />
            </IconButton>
          )}
          items={menuItems}
          align="right"
        />
      </div>
    </div>
  );
}
