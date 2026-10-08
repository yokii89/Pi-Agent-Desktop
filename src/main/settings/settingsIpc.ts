import { ipcMain } from "electron";
import { isFontMonoPreset, isFontUiPreset } from "../../shared/fontPresets";
import type {
  BrowserRecentUrl,
  IpcResult,
  PideskProject,
  PideskSettings,
  TerminalShellKind,
  ThemeId,
} from "../../shared/ipc";
import {
  SESSION_STREAM_FONT_MAX_PX,
  SESSION_STREAM_FONT_MIN_PX,
  SETTINGS_IPC,
} from "../../shared/ipc";
import {
  type NotificationSettings,
  normalizeNotificationSettings,
} from "../../shared/notification";
import { isRailStyle } from "../../shared/railStyles";
import { sanitizeShortcutsRecord } from "../../shared/shortcuts";
import { envelope } from "../ipc/envelope";
import { onPrefetchSettingChanged } from "../session/speculativePrefetch";
import { applyTrayEnabled } from "../window/tray";
import { clampSessionStreamFontPx, SETTABLE_KEYS, sanitizeArchivedSessions } from "./schema";
import { getSettings, updateSettings } from "./settings";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function sanitizeProjects(value: unknown): PideskProject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const projects: PideskProject[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Partial<PideskProject>;
    const dir = asString(item.dir);
    if (!dir) continue;
    projects.push({
      id: asString(item.id) ?? dir,
      name: asString(item.name) ?? dir,
      dir,
    });
  }
  return projects;
}

function sanitizeRecentUrls(value: unknown): BrowserRecentUrl[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const urls: BrowserRecentUrl[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Partial<BrowserRecentUrl>;
    const url = asString(item.url);
    if (!url) continue;
    urls.push({ url, at: typeof item.at === "number" ? item.at : Date.now() });
  }
  return urls;
}

function sanitizePinnedSessions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files: string[] = [];
  for (const raw of value) {
    const file = asString(raw);
    // 同一会话只应出现一次：数组本身就是"置顶顺序"，重复项会把顺序搅乱
    if (file && !files.includes(file)) files.push(file);
  }
  return files;
}

/** 会话自定义标题（JSONL 路径 → 标题）；空标题等于"没自定义"，直接丢掉而不是存空串。 */
function sanitizeSessionTitles(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const titles: Record<string, string> = {};
  for (const [file, raw] of Object.entries(value as Record<string, unknown>)) {
    const title = asString(raw);
    if (file && title) titles[file] = title;
  }
  return titles;
}

/** 提示音配置：与当前设置深合并后再归一，避免局部 patch 冲掉用户音色映射。 */
function sanitizeNotification(value: unknown): NotificationSettings | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const current = getSettings().notification;
  const raw = value as Partial<NotificationSettings>;
  return normalizeNotificationSettings({
    ...current,
    ...raw,
    scenarios: {
      ...current.scenarios,
      ...(raw.scenarios && typeof raw.scenarios === "object" ? raw.scenarios : {}),
    },
  });
}

/** 渲染层传入的 patch 只允许白名单键，且逐项校验类型。 */
function sanitizePatch(patch: unknown): Partial<PideskSettings> {
  if (typeof patch !== "object" || patch === null) {
    throw new Error("设置更新请求格式错误");
  }
  const raw = patch as Record<string, unknown>;
  const clean: Partial<PideskSettings> = {};
  for (const key of SETTABLE_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    switch (key) {
      case "projects": {
        const projects = sanitizeProjects(value);
        if (projects) clean.projects = projects;
        break;
      }
      case "pinnedSessions": {
        const files = sanitizePinnedSessions(value);
        if (files) clean.pinnedSessions = files;
        break;
      }
      case "sessionTitles": {
        const titles = sanitizeSessionTitles(value);
        if (titles) clean.sessionTitles = titles;
        break;
      }
      case "archivedSessions": {
        // 归档表与读盘兜底共用同一份结构校验（docs/design/32）；整表形状非法时丢弃该键，不清空用户归档
        const archived = sanitizeArchivedSessions(value);
        if (archived) clean.archivedSessions = archived;
        break;
      }
      case "browserRecentUrls": {
        const urls = sanitizeRecentUrls(value);
        if (urls) clean.browserRecentUrls = urls;
        break;
      }
      case "lastProjectId":
      case "piExecutablePath":
      case "defaultProjectDir":
        clean[key] = asString(value);
        break;
      case "terminalShell":
        if (value === "powershell" || value === "cmd" || value === "gitbash")
          clean.terminalShell = value as TerminalShellKind;
        break;
      case "theme":
        if (value === "dark" || value === "light") clean.theme = value as ThemeId;
        break;
      case "navCollapsed":
      case "showInTray":
      case "browserEnabled":
      case "browserLoginImportConsent":
      case "sessionPrefetchEnabled":
      case "welcomeRecentsEnabled":
        if (typeof value === "boolean") clean[key] = value;
        break;
      case "browserViewportWidth":
        clean.browserViewportWidth =
          typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
        break;
      case "maxParallelSessions": {
        if (typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 32) {
          clean.maxParallelSessions = Math.floor(value);
        }
        break;
      }
      case "sessionStreamFontPx": {
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= SESSION_STREAM_FONT_MIN_PX &&
          value <= SESSION_STREAM_FONT_MAX_PX
        ) {
          clean.sessionStreamFontPx = clampSessionStreamFontPx(value);
        }
        break;
      }
      case "fontUiPreset":
        // 白名单外的值整项丢弃，不把脏 id 写进设置
        if (isFontUiPreset(value)) clean.fontUiPreset = value;
        break;
      case "fontMonoPreset":
        if (isFontMonoPreset(value)) clean.fontMonoPreset = value;
        break;
      case "questionRailStyle":
        // 白名单外的值整项丢弃，不把脏 id 写进设置
        if (isRailStyle(value)) clean.questionRailStyle = value;
        break;
      case "notification": {
        const notification = sanitizeNotification(value);
        if (notification) clean.notification = notification;
        break;
      }
      case "shortcuts": {
        // 整表深合并 + 结构校验：局部 patch 冲不掉未提交的命令映射；
        // 合法清单由渲染层注册表归一（hydrate 必经），主进程不持动作清单
        if (value && typeof value === "object" && !Array.isArray(value)) {
          clean.shortcuts = sanitizeShortcutsRecord({
            ...getSettings().shortcuts,
            ...(value as Record<string, unknown>),
          });
        }
        break;
      }
    }
  }
  return clean;
}

/** 注册设置读写 IPC（docs/design/03 §8）。 */
export function registerSettingsIpc(): void {
  ipcMain.handle(SETTINGS_IPC.get, (): IpcResult<PideskSettings> => envelope(() => getSettings()));

  ipcMain.handle(
    SETTINGS_IPC.set,
    (_event, patch: unknown): IpcResult<PideskSettings> =>
      envelope(() => {
        const next = updateSettings(sanitizePatch(patch));
        // 托盘是主进程副作用：设置写穿后立即对齐，避免重启才生效
        applyTrayEnabled(next.showInTray);
        // speculative 预热开关：关闭时回收无用 speculative 实例
        if ("sessionPrefetchEnabled" in (patch as object)) {
          onPrefetchSettingChanged(next.sessionPrefetchEnabled === true);
        }
        return next;
      }),
  );
}
