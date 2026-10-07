import type { TranslateFn } from "../../../shared/i18n";
import { getI18nLocale } from "../../../shared/i18n";
import { nextRunAfter, type ScheduleRule } from "../../../shared/scheduler";
import { formatAbsoluteTime, formatElapsed } from "../../utils/time";

/**
 * 定时任务的展示层纯函数：规则摘要、下次触发、偏差与 datetime-local 换算。
 * 列表行 / 创建确认页 / 设置概览共用，避免三处口径漂移。
 */

/** 周几集合的一句话（工作日合并展示，其余按周几逐个列出）。 */
export function describeWeekdays(t: TranslateFn, weekdays: number[]): string {
  const isWorkweek =
    weekdays.length === 5 && [1, 2, 3, 4, 5].every((day) => weekdays.includes(day));
  if (isWorkweek) return t("scheduled.weekdays.workday");
  const names = weekdays.map((day) => t(`scheduled.weekday.${day}`));
  return names.join(getI18nLocale() === "zh-CN" ? "、" : ", ");
}

/** 调度规则的一句话摘要。 */
export function describeScheduleRule(t: TranslateFn, rule: ScheduleRule): string {
  switch (rule.kind) {
    case "interval":
      return rule.minutes >= 60 && rule.minutes % 60 === 0
        ? t("scheduled.rule.interval.hours", { n: rule.minutes / 60 })
        : t("scheduled.rule.interval.minutes", { n: rule.minutes });
    case "daily": {
      if (!rule.weekdays) return t("scheduled.rule.daily", { time: rule.time });
      return t("scheduled.rule.weekdays", {
        days: describeWeekdays(t, rule.weekdays),
        time: rule.time,
      });
    }
    case "once":
      return t("scheduled.rule.once", { datetime: formatAbsoluteTime(rule.at) });
  }
}

/** 下次触发的紧凑展示：今天给 HH:mm，跨天给 M/D HH:mm；null 表示无计划。 */
export function formatNextRunTime(nextRunAt: number | null): string | null {
  if (nextRunAt === null) return null;
  const at = new Date(nextRunAt);
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  const hhmm = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  ) {
    return hhmm;
  }
  return `${at.getMonth() + 1}/${at.getDate()} ${hhmm}`;
}

/** 从「现在」起算的下次触发预览（创建/编辑表单实时预览用，锚点取当前时刻）。 */
export function previewNextRun(rule: ScheduleRule, now = Date.now()): number | null {
  return nextRunAfter(rule, now, now);
}

/** 调度偏差（计划 vs 实际派发），复用 run 头的紧凑用时口径。 */
export function formatDeviation(deviationMs: number): string {
  return formatElapsed(Math.max(0, deviationMs));
}

/** Unix ms → datetime-local 输入值（本地时区）。 */
export function toLocalInputValue(ms: number): string {
  const at = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** datetime-local 输入值 → Unix ms；非法返回 null。 */
export function fromLocalInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
