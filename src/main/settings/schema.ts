import { DEFAULT_FONT_MONO_PRESET, DEFAULT_FONT_UI_PRESET } from "../../shared/fontPresets";
import {
  clampSessionStreamFontPx,
  DEFAULT_SESSION_STREAM_FONT_PX,
  type PideskSettings,
} from "../../shared/ipc";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
} from "../../shared/notification";
import { DEFAULT_RAIL_STYLE } from "../../shared/railStyles";
import type { ShortcutsMap } from "../../shared/shortcuts";

/** 设置 schema 当前版本；未来字段迁移时递增并编写迁移逻辑。 */
export const SETTINGS_VERSION = 1;

export { clampSessionStreamFontPx, DEFAULT_SESSION_STREAM_FONT_PX };

/** 默认设置；与 docs/design/03 §6 对齐。 */
export const DEFAULT_SETTINGS: PideskSettings = {
  projects: [],
  lastProjectId: null,
  piExecutablePath: null,
  terminalShell: "powershell",
  theme: "dark",
  locale: "system",
  navCollapsed: false,
  pinnedSessions: [],
  archivedSessions: {},
  sessionTitles: {},
  browserRecentUrls: [],
  browserViewportWidth: null,
  defaultProjectDir: null,
  showInTray: false,
  browserEnabled: true,
  // 导入登录状态须知：同意一次后不再重复展示
  browserLoginImportConsent: false,
  // 并行 pi 会话上限（多会话架构决策 #7）；超限 start 失败，不自动杀最旧
  maxParallelSessions: 8,
  // 会话预热默认开启（docs/design/44：打开/新建会话即触发，把冷启动移到发送之前）
  sessionPrefetchEnabled: true,
  // 欢迎页最近会话入口默认关闭：新会话界面保持干净，回访入口由侧栏承担
  welcomeRecentsEnabled: false,
  // 系统提示音（docs/design/18）；深拷贝，避免与 DEFAULT_NOTIFICATION_SETTINGS 共享嵌套对象
  notification: normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS),
  // LLM 对话流正文默认字号（与 tokens.css --session-stream-font-md 对齐）
  sessionStreamFontPx: DEFAULT_SESSION_STREAM_FONT_PX,
  // 界面 / 等宽字体预设（与 tokens.css --font-family-* 默认栈对齐）
  fontUiPreset: DEFAULT_FONT_UI_PRESET,
  fontMonoPreset: DEFAULT_FONT_MONO_PRESET,
  // 对话流问题导航分段栏标记样式（设置 → 个性化）；默认短线，向后兼容
  questionRailStyle: DEFAULT_RAIL_STYLE,
  // 渲染层全局快捷键（设置 → 键盘快捷键）；默认映射由渲染层动作注册表提供，
  // 主进程只持有结构校验后的透传值（hydrate 时归一）
  shortcuts: {} as ShortcutsMap,
};

/** 设置文件名（userData 下）。 */
export const SETTINGS_FILENAME = "settings.json";

/**
 * 归档会话表的结构校验（docs/design/32）：键为 JSONL 路径、值为归档时间 Unix ms。
 * 读盘兜底与 IPC patch 校验共用同一份规则，保证设置里永远不会出现坏形状的表；
 * 非法条目丢弃、整表形状非法返回 undefined（IPC 侧丢弃该键而不是清空用户归档，
 * 时间非法的条目直接丢——渲染层写入时总带 Date.now()，没有可兜底的默认值）。
 */
export function sanitizeArchivedSessions(value: unknown): Record<string, number> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const archived: Record<string, number> = {};
  for (const [file, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!file) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
    archived[file] = raw;
  }
  return archived;
}

/** 允许通过 IPC 更新的设置键白名单。 */
export const SETTABLE_KEYS = [
  "projects",
  "lastProjectId",
  "piExecutablePath",
  "terminalShell",
  "theme",
  "locale",
  "navCollapsed",
  "pinnedSessions",
  "archivedSessions",
  "sessionTitles",
  "browserRecentUrls",
  "browserViewportWidth",
  "defaultProjectDir",
  "showInTray",
  "browserEnabled",
  "browserLoginImportConsent",
  "maxParallelSessions",
  "sessionPrefetchEnabled",
  "welcomeRecentsEnabled",
  "notification",
  "sessionStreamFontPx",
  "fontUiPreset",
  "fontMonoPreset",
  "questionRailStyle",
  "shortcuts",
] as const satisfies readonly (keyof PideskSettings)[];
