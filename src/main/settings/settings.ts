import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { normalizeFontMonoPreset, normalizeFontUiPreset } from "../../shared/fontPresets";
import { normalizeLocalePreference, resolveLocale, setI18nLocale } from "../../shared/i18n";
import type { PideskSettings } from "../../shared/ipc";
import { normalizeNotificationSettings } from "../../shared/notification";
import { normalizeRailStyle } from "../../shared/railStyles";
import { sanitizeShortcutsRecord } from "../../shared/shortcuts";
import {
  clampSessionStreamFontPx,
  DEFAULT_SETTINGS,
  SETTINGS_FILENAME,
  sanitizeArchivedSessions,
} from "./schema";

/**
 * 配置目录决策：PiDesk 自身设置落在 Electron `userData`（Windows 即
 * `%APPDATA%/pidesk/settings.json`），**不**放进 pi 的 `~/.pi`。
 * - `~/.pi` 是 pi 的数据域（会话 JSONL / auth.json / pi settings.json），
 *   混入 PiDesk 主题、侧栏、托盘等 UI 状态会污染 pi 命名空间；
 * - `userData` 是 Electron 平台约定，卸载、便携版、多用户行为正确；
 * - 需要写给 pi 的配置（默认模型、shellPath）走 `session/piSettings.ts`
 *   写到 `~/.pi/agent/settings.json`，职责边界保持清晰。
 */

let cache: PideskSettings | null = null;

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILENAME);
}

/**
 * 读取设置（内存缓存）。文件缺失或损坏时回退默认值，
 * 不抛错——设置读失败不应阻塞应用启动。
 */
export function getSettings(): PideskSettings {
  if (cache) return cache;
  let loaded: Partial<PideskSettings> = {};
  try {
    loaded = JSON.parse(fs.readFileSync(settingsFilePath(), "utf8")) as Partial<PideskSettings>;
  } catch {
    // 首次运行或文件损坏：使用默认值，下次写入时覆盖
  }
  cache = {
    ...DEFAULT_SETTINGS,
    ...loaded,
    locale: normalizeLocalePreference(loaded.locale),
    projects: Array.isArray(loaded.projects) ? loaded.projects : DEFAULT_SETTINGS.projects,
    // 手改过设置文件时也要保证是字符串数组，避免渲染层拿到非数组后崩溃
    pinnedSessions: Array.isArray(loaded.pinnedSessions)
      ? loaded.pinnedSessions.filter((file): file is string => typeof file === "string")
      : DEFAULT_SETTINGS.pinnedSessions,
    // 同理：非对象（手改坏了）时回退空表，避免渲染层读属性时崩
    sessionTitles:
      loaded.sessionTitles && typeof loaded.sessionTitles === "object"
        ? loaded.sessionTitles
        : DEFAULT_SETTINGS.sessionTitles,
    // 归档表同样只保结构：键为路径、值为归档时间的合法条目才保留（docs/design/32）
    archivedSessions:
      sanitizeArchivedSessions(loaded.archivedSessions) ?? DEFAULT_SETTINGS.archivedSessions,
    maxParallelSessions:
      typeof loaded.maxParallelSessions === "number" &&
      Number.isFinite(loaded.maxParallelSessions) &&
      loaded.maxParallelSessions >= 1
        ? Math.floor(loaded.maxParallelSessions)
        : DEFAULT_SETTINGS.maxParallelSessions,
    notification: normalizeNotificationSettings(loaded.notification),
    // 手改设置文件时把字号夹回合法范围，非法值回退默认
    sessionStreamFontPx: clampSessionStreamFontPx(loaded.sessionStreamFontPx),
    fontUiPreset: normalizeFontUiPreset(loaded.fontUiPreset),
    fontMonoPreset: normalizeFontMonoPreset(loaded.fontMonoPreset),
    questionRailStyle: normalizeRailStyle(loaded.questionRailStyle),
    // 快捷键只做结构校验：合法清单由渲染层注册表归一（hydrate 必经，兜底等价前移）
    shortcuts: sanitizeShortcutsRecord(loaded.shortcuts),
  };
  setI18nLocale(resolveLocale(cache.locale, app.getLocale()));
  return cache;
}

/** 合并更新设置并写盘（写穿；调用频率低，同步写即可）。 */
export function updateSettings(patch: Partial<PideskSettings>): PideskSettings {
  const next: PideskSettings = { ...getSettings(), ...patch };
  next.locale = normalizeLocalePreference(next.locale);
  next.fontUiPreset = normalizeFontUiPreset(next.fontUiPreset);
  next.fontMonoPreset = normalizeFontMonoPreset(next.fontMonoPreset);
  next.questionRailStyle = normalizeRailStyle(next.questionRailStyle);
  next.shortcuts = sanitizeShortcutsRecord(next.shortcuts);
  cache = next;
  setI18nLocale(resolveLocale(next.locale, app.getLocale()));
  const file = settingsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}
