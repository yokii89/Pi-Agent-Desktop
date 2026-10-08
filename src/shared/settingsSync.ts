import type { PideskSettings } from "./ipc";

/**
 * 设置同步：可同步「用户偏好」白名单（docs/design/36 §6）。
 * 机器本地键（路径、会话索引、同意标记等）永不进入 Gist。
 */
export const SYNCABLE_SETTINGS_KEYS = [
  "theme",
  "locale",
  "navCollapsed",
  "showInTray",
  "browserEnabled",
  "sessionPrefetchEnabled",
  "welcomeRecentsEnabled",
  "notification",
  "sessionStreamFontPx",
  "fontUiPreset",
  "fontMonoPreset",
  "questionRailStyle",
  "shortcuts",
] as const satisfies readonly (keyof PideskSettings)[];

export type SyncableSettingsKey = (typeof SYNCABLE_SETTINGS_KEYS)[number];
export type SyncableSettings = Pick<PideskSettings, SyncableSettingsKey>;

/** Secret Gist 内固定文件名；靠它在多端发现同一份配置。 */
export const SETTINGS_GIST_FILENAME = "pidesk-settings.json";
export const SETTINGS_GIST_DESCRIPTION = "PiDesk settings";

/** Gist 载荷信封；`format` 用于后续迁移。 */
export interface SettingsSyncEnvelope {
  format: 1;
  updatedAt: number;
  appVersion: string;
  deviceName: string;
  settings: SyncableSettings;
}

/** 从完整设置中裁出可同步子集。 */
export function pickSyncableSettings(settings: PideskSettings): SyncableSettings {
  return {
    theme: settings.theme,
    locale: settings.locale,
    navCollapsed: settings.navCollapsed,
    showInTray: settings.showInTray,
    browserEnabled: settings.browserEnabled,
    sessionPrefetchEnabled: settings.sessionPrefetchEnabled,
    welcomeRecentsEnabled: settings.welcomeRecentsEnabled,
    notification: settings.notification,
    sessionStreamFontPx: settings.sessionStreamFontPx,
    fontUiPreset: settings.fontUiPreset,
    fontMonoPreset: settings.fontMonoPreset,
    questionRailStyle: settings.questionRailStyle,
    shortcuts: settings.shortcuts,
  };
}

/**
 * 解析 Gist 载荷。只认 format=1 且 settings 为对象；
 * 非法/未知格式返回 null（拉取侧提示「远端格式不受支持」，不覆盖本地）。
 */
export function parseSettingsSyncEnvelope(raw: unknown): SettingsSyncEnvelope | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Partial<SettingsSyncEnvelope>;
  if (obj.format !== 1) return null;
  if (typeof obj.settings !== "object" || obj.settings === null) return null;
  if (typeof obj.updatedAt !== "number" || !Number.isFinite(obj.updatedAt)) {
    return null;
  }
  return {
    format: 1,
    updatedAt: obj.updatedAt,
    appVersion: typeof obj.appVersion === "string" ? obj.appVersion : "",
    deviceName: typeof obj.deviceName === "string" ? obj.deviceName : "",
    settings: obj.settings as SyncableSettings,
  };
}

/** 设置值摘要：标量直接展示，嵌套对象/列表收成短文案（差异预览用）。 */
export function summarizeSettingValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  if (Array.isArray(value)) return `列表(${value.length})`;
  return "对象";
}

/** 两值是否等价（对象走 JSON 比较，键序无关由浅层字段稳定性保证）。 */
export function settingValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** 逐键比较可同步子集，返回有差异的键。 */
export function diffSyncableSettings(
  local: SyncableSettings,
  remote: Partial<SyncableSettings>,
): Array<{ key: SyncableSettingsKey; local: string; remote: string }> {
  const changes: Array<{ key: SyncableSettingsKey; local: string; remote: string }> = [];
  for (const key of SYNCABLE_SETTINGS_KEYS) {
    if (!(key in remote)) continue;
    const localValue = local[key];
    const remoteValue = remote[key];
    if (settingValuesEqual(localValue, remoteValue)) continue;
    changes.push({
      key,
      local: summarizeSettingValue(localValue),
      remote: summarizeSettingValue(remoteValue),
    });
  }
  return changes;
}
