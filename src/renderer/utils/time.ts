import { getI18nLocale, t } from "../../shared/i18n";

/**
 * 紧凑相对时间（侧栏历史条目右侧，"3分 / 2小时 / 3天"）。
 * 文案走 i18n（模块级 t）；超过 30 天退化为短日期（"9月1日" / "Sep 1"），
 * 超过一年只留年份——这是给窄侧栏右槽用的格式，完整时间戳见悬浮详情卡与命令面板。
 */
export function formatShortRelativeTime(timestampMs: number): string {
  if (!timestampMs) return "";
  const diff = Date.now() - timestampMs;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return t("common.time.now");
  if (diff < hour) return t("common.time.minutes", { count: Math.floor(diff / minute) });
  if (diff < day) return t("common.time.hours", { count: Math.floor(diff / hour) });
  if (diff < 30 * day) return t("common.time.days", { count: Math.floor(diff / day) });
  const locale = getI18nLocale();
  if (diff < 365 * day) {
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(timestampMs);
  }
  return new Intl.DateTimeFormat(locale, { year: "numeric" }).format(timestampMs);
}

/** 绝对时间（悬浮详情卡的"更新于"）：2026-09-14 13:58:12，本地时区。 */
export function formatAbsoluteTime(timestampMs: number): string {
  if (!timestampMs) return "未知";
  const at = new Date(timestampMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`,
  ].join(" ");
}

/** 紧凑用时（run 头 / 工具行）：`12s` / `1m 04s` / `3h 23m 33s`。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${seconds}s`;
  }
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
