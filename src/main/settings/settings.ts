import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { normalizeAccentColor } from "../../shared/accentColor";
import { normalizeFontMonoPreset, normalizeFontUiPreset } from "../../shared/fontPresets";
import { normalizeLocalePreference, resolveLocale, setI18nLocale } from "../../shared/i18n";
import { normalizeInputBuddy } from "../../shared/inputBuddy";
import type { PideskSettings } from "../../shared/ipc";
import { normalizeNotificationSettings } from "../../shared/notification";
import { normalizeRailStyle } from "../../shared/railStyles";
import { sanitizeShortcutsRecord } from "../../shared/shortcuts";
import {
  clampSplashLogoSize,
  clampSplashSpeed,
  DEFAULT_SPLASH_TEXT_EN,
  DEFAULT_SPLASH_TEXT_SUB,
  DEFAULT_SPLASH_TEXT_ZH,
  normalizeSplashFontPreset,
  normalizeSplashLogoImage,
  normalizeSplashText,
} from "../../shared/splash";
import { clampWallpaperDim, normalizeWallpaperPath } from "../../shared/wallpaper";
import {
  clampSessionStreamFontPx,
  DEFAULT_SETTINGS,
  SETTINGS_FILENAME,
  sanitizeArchivedSessions,
  sanitizeSessionOrder,
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

/**
 * 旧版会话标题（settings.sessionTitles）只用于一次性迁移到 pi 的 session_info。
 * 读盘时从缓存对象里剥掉，避免更新设置时又把废弃键写回去；
 * 但迁移完成前必须把它带回磁盘——否则迁移失败的条目会被任意一次设置写盘抹掉，
 * 再也没有下次启动重试的机会。
 */
type LegacySessionTitles = Record<string, string>;

export interface LegacySessionTitlesSnapshot {
  titles: LegacySessionTitles;
  hadKey: boolean;
}

let legacySessionTitles: LegacySessionTitles = {};
let legacySessionTitlesPresent = false;

function sanitizeLegacySessionTitles(value: unknown): LegacySessionTitles {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const titles: LegacySessionTitles = {};
  for (const [file, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!file || typeof raw !== "string") continue;
    const title = raw.trim();
    if (title) titles[file] = title;
  }
  return titles;
}

/** 取启动时读到的旧标题快照；迁移结束前仍保留在写盘载荷里。 */
export function takeLegacySessionTitles(): LegacySessionTitlesSnapshot {
  return { titles: legacySessionTitles, hadKey: legacySessionTitlesPresent };
}

/**
 * 迁移收口：remaining 为 null 表示旧键可以移除；非空表示只保留未迁成功的条目，
 * 随设置一起写回，下次启动重试。
 */
export function settleLegacySessionTitles(remaining: LegacySessionTitles | null): void {
  legacySessionTitles = remaining ?? {};
  legacySessionTitlesPresent = remaining !== null && Object.keys(remaining).length > 0;
}

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILENAME);
}

/**
 * 读取设置（内存缓存）。文件缺失或损坏时回退默认值，
 * 不抛错——设置读失败不应阻塞应用启动。
 */
export function getSettings(): PideskSettings {
  if (cache) return cache;
  let loaded: Partial<PideskSettings> & { sessionTitles?: unknown } = {};
  try {
    loaded = JSON.parse(fs.readFileSync(settingsFilePath(), "utf8")) as Partial<PideskSettings> & {
      sessionTitles?: unknown;
    };
  } catch {
    // 首次运行或文件损坏：使用默认值，下次写入时覆盖
  }
  const { sessionTitles: rawSessionTitles, ...settings } = loaded;
  if (rawSessionTitles !== undefined) {
    legacySessionTitles = sanitizeLegacySessionTitles(rawSessionTitles);
    legacySessionTitlesPresent = true;
  }
  cache = {
    ...DEFAULT_SETTINGS,
    ...settings,
    locale: normalizeLocalePreference(loaded.locale),
    projects: Array.isArray(loaded.projects) ? loaded.projects : DEFAULT_SETTINGS.projects,
    // 手改过设置文件时也要保证是字符串数组，避免渲染层拿到非数组后崩溃
    pinnedSessions: Array.isArray(settings.pinnedSessions)
      ? settings.pinnedSessions.filter((file): file is string => typeof file === "string")
      : DEFAULT_SETTINGS.pinnedSessions,
    globalPinnedSessions: Array.isArray(settings.globalPinnedSessions)
      ? settings.globalPinnedSessions.filter((file): file is string => typeof file === "string")
      : DEFAULT_SETTINGS.globalPinnedSessions,
    // 归档表同样只保结构：键为路径、值为归档时间的合法条目才保留（docs/design/32）
    archivedSessions:
      sanitizeArchivedSessions(settings.archivedSessions) ?? DEFAULT_SETTINGS.archivedSessions,
    // 项目内手动顺序同理只保结构（项目 id → 去重后的路径数组）；docs/design/109
    sessionOrder: sanitizeSessionOrder(settings.sessionOrder) ?? DEFAULT_SETTINGS.sessionOrder,
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
    // 手改设置文件时把非法主题色回退默认，避免渲染层拿着脏值写 CSS 变量
    accentColor: normalizeAccentColor(loaded.accentColor),
    // 壁纸路径 / 遮罩强度同样归一：不支持的文件类型与非法强度都回退默认（docs/design/111）
    wallpaperPath: normalizeWallpaperPath(loaded.wallpaperPath),
    wallpaperDim: clampWallpaperDim(loaded.wallpaperDim),
    // 手改设置文件时把未知形象 id 回退默认，避免渲染层拿着空值不画
    inputBuddy: normalizeInputBuddy(loaded.inputBuddy),
    // 快捷键只做结构校验：合法清单由渲染层注册表归一（hydrate 必经，兜底等价前移）
    shortcuts: sanitizeShortcutsRecord(loaded.shortcuts),
    // 启动动画：手改设置文件时也把标识 / 字号 / 速度 / 字体归一
    splashEnabled: typeof loaded.splashEnabled === "boolean" ? loaded.splashEnabled : true,
    splashLogoImage: normalizeSplashLogoImage(loaded.splashLogoImage),
    splashLogoSize: clampSplashLogoSize(loaded.splashLogoSize),
    splashFontPreset: normalizeSplashFontPreset(loaded.splashFontPreset),
    splashTextZh: normalizeSplashText(loaded.splashTextZh, DEFAULT_SPLASH_TEXT_ZH),
    splashTextEn: normalizeSplashText(loaded.splashTextEn, DEFAULT_SPLASH_TEXT_EN),
    splashTextSub: normalizeSplashText(loaded.splashTextSub, DEFAULT_SPLASH_TEXT_SUB),
    splashSpeed: clampSplashSpeed(loaded.splashSpeed),
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
  next.inputBuddy = normalizeInputBuddy(next.inputBuddy);
  next.accentColor = normalizeAccentColor(next.accentColor);
  next.wallpaperPath = normalizeWallpaperPath(next.wallpaperPath);
  next.wallpaperDim = clampWallpaperDim(next.wallpaperDim);
  next.shortcuts = sanitizeShortcutsRecord(next.shortcuts);
  next.sessionOrder = sanitizeSessionOrder(next.sessionOrder) ?? DEFAULT_SETTINGS.sessionOrder;
  next.splashEnabled = next.splashEnabled !== false;
  next.splashLogoImage = normalizeSplashLogoImage(next.splashLogoImage);
  next.splashLogoSize = clampSplashLogoSize(next.splashLogoSize);
  next.splashFontPreset = normalizeSplashFontPreset(next.splashFontPreset);
  next.splashTextZh = normalizeSplashText(next.splashTextZh, DEFAULT_SPLASH_TEXT_ZH);
  next.splashTextEn = normalizeSplashText(next.splashTextEn, DEFAULT_SPLASH_TEXT_EN);
  next.splashTextSub = normalizeSplashText(next.splashTextSub, DEFAULT_SPLASH_TEXT_SUB);
  next.splashSpeed = clampSplashSpeed(next.splashSpeed);
  cache = next;
  setI18nLocale(resolveLocale(next.locale, app.getLocale()));
  const file = settingsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = legacySessionTitlesPresent
    ? { ...next, sessionTitles: legacySessionTitles }
    : next;
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return next;
}
