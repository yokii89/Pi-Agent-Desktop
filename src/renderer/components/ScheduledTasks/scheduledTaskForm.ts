import type { ScheduledTask, ScheduleRule } from "../../../shared/scheduler";

export type ModeId = "interval" | "daily" | "once";
export type TargetId = "new" | "bound";

export interface FormState {
  name: string;
  cwd: string;
  mode: ModeId;
  intervalMinutes: string;
  dailyTime: string;
  weekdays: number[];
  onceValue: string;
  target: TargetId;
  sessionFile: string;
  prompt: string;
}

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const WORKWEEK = [1, 2, 3, 4, 5];

export function formFromTask(task: ScheduledTask | null): FormState {
  if (!task) {
    const at = new Date(Date.now() + 60 * 60_000);
    const pad = (value: number): string => String(value).padStart(2, "0");
    return {
      name: "",
      cwd: "",
      mode: "daily",
      intervalMinutes: "30",
      dailyTime: "09:00",
      weekdays: [...WORKWEEK],
      onceValue: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`,
      target: "new",
      sessionFile: "",
      prompt: "",
    };
  }
  const rule = task.rule;
  return {
    name: task.name,
    cwd: task.cwd,
    mode: rule.kind === "interval" ? "interval" : rule.kind === "daily" ? "daily" : "once",
    intervalMinutes: rule.kind === "interval" ? String(rule.minutes) : "30",
    dailyTime: rule.kind === "daily" ? rule.time : "09:00",
    weekdays: rule.kind === "daily" && rule.weekdays ? [...rule.weekdays] : [...ALL_WEEKDAYS],
    onceValue: rule.kind === "once" ? toLocalValue(rule.at) : "",
    target: task.sessionFile ? "bound" : "new",
    sessionFile: task.sessionFile ?? "",
    prompt: task.prompt,
  };
}

/** 从表单装配调度规则（未校验；统一走 sanitizeSchedulerTaskInput 收口）。 */
export function ruleFromForm(form: FormState): ScheduleRule {
  switch (form.mode) {
    case "interval":
      return { kind: "interval", minutes: Number(form.intervalMinutes) };
    case "daily":
      return {
        kind: "daily",
        time: form.dailyTime,
        weekdays: form.weekdays.length === 7 ? null : [...form.weekdays],
      };
    case "once":
      return { kind: "once", at: fromLocalValue(form.onceValue) ?? 0 };
  }
}

// 本地换算与 scheduleText 一致，避免表单模型再依赖展示层
function toLocalValue(ms: number): string {
  const at = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function fromLocalValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
