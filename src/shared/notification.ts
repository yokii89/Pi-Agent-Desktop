/**
 * 系统提示音共享契约（docs/design/18）。
 * 设置持久化、主进程门禁与渲染层播放共用同一套场景/音色语义。
 */

/** 内置提示音文件 id（src/renderer/assets/notification/<id>.mp3）。 */
export const NOTIFICATION_SOUNDS = ["1", "2", "3", "4", "5"] as const;
export type NotificationSoundId = (typeof NOTIFICATION_SOUNDS)[number];

/**
 * 提示音场景。
 * `terminalExit` 仅内建触发；SDK 可触发其余场景（含 `custom`）。
 */
export type NotificationScenarioId =
  | "completed"
  | "failed"
  | "needsAttention"
  | "interrupted"
  | "terminalExit"
  | "custom";

/** SDK 可声明的场景子集（不含仅内建的 terminalExit）。 */
export const SDK_NOTIFICATION_SCENARIOS = [
  "completed",
  "failed",
  "needsAttention",
  "interrupted",
  "custom",
] as const satisfies readonly NotificationScenarioId[];

export type SdkNotificationScenarioId = (typeof SDK_NOTIFICATION_SCENARIOS)[number];

/**
 * 焦点策略：
 * - always：场景开启即播
 * - muteActiveFocused：窗口聚焦且触发源为当前 active 会话时静音轻提示（默认，利于多会话并行）
 * - muteWhenFocused：窗口聚焦时静音轻提示
 */
export type NotificationFocusPolicy = "always" | "muteActiveFocused" | "muteWhenFocused";

export interface NotificationScenarioConfig {
  enabled: boolean;
  sound: NotificationSoundId;
}

export interface NotificationSettings {
  enabled: boolean;
  /** 0–1 播放增益。 */
  volume: number;
  focusPolicy: NotificationFocusPolicy;
  /** 关键场景（failed/needsAttention/custom）不受焦点静音限制。 */
  criticalIgnoresFocus: boolean;
  debounceMs: number;
  /**
   * 系统桌面 toast（Windows 右下角，docs/design/24）。
   * 与提示音总开关 `enabled` 独立；仅主窗口未聚焦时展示。
   */
  systemToast: boolean;
  scenarios: Record<NotificationScenarioId, NotificationScenarioConfig>;
}

/** 关键场景：默认不受焦点静音限制。 */
export const CRITICAL_NOTIFICATION_SCENARIOS: ReadonlySet<NotificationScenarioId> = new Set([
  "failed",
  "needsAttention",
  "custom",
]);

/** 场景展示用文案 key；渲染层经 useT / 模块 t 取当前语言。 */
export const NOTIFICATION_SCENARIO_LABEL_KEYS: Record<NotificationScenarioId, string> = {
  completed: "notification.scenario.completed",
  failed: "notification.scenario.failed",
  needsAttention: "notification.scenario.needsAttention",
  interrupted: "notification.scenario.interrupted",
  terminalExit: "notification.scenario.terminalExit",
  custom: "notification.scenario.custom",
};

export const NOTIFICATION_SCENARIO_HINT_KEYS: Record<NotificationScenarioId, string> = {
  completed: "notification.scenarioHint.completed",
  failed: "notification.scenarioHint.failed",
  needsAttention: "notification.scenarioHint.needsAttention",
  interrupted: "notification.scenarioHint.interrupted",
  terminalExit: "notification.scenarioHint.terminalExit",
  custom: "notification.scenarioHint.custom",
};

export function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  return typeof value === "string" && (NOTIFICATION_SOUNDS as readonly string[]).includes(value);
}

export function isNotificationScenarioId(value: unknown): value is NotificationScenarioId {
  return typeof value === "string" && value in NOTIFICATION_SCENARIO_LABEL_KEYS;
}

function scenario(enabled: boolean, sound: NotificationSoundId): NotificationScenarioConfig {
  return { enabled, sound };
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  volume: 0.7,
  focusPolicy: "muteActiveFocused",
  criticalIgnoresFocus: true,
  debounceMs: 400,
  systemToast: true,
  scenarios: {
    completed: scenario(true, "1"),
    failed: scenario(true, "2"),
    needsAttention: scenario(true, "3"),
    interrupted: scenario(false, "4"),
    terminalExit: scenario(false, "5"),
    custom: scenario(true, "3"),
  },
};

/** 渲染层/主进程播放请求（Host 推送与内建触发共用）。 */
export interface NotificationPlayRequest {
  scenario: NotificationScenarioId;
  /** 覆盖场景默认内置音色。 */
  sound?: NotificationSoundId;
  sessionId?: string;
  reason?: string;
  source?: "session" | "terminal" | "extension" | "sdk" | "preview";
}

export type NotificationPlaySource = NonNullable<NotificationPlayRequest["source"]>;

export const NOTIFICATION_IPC = {
  /** 主进程 → 渲染层：请求播放提示音（扩展 SDK 等宿主服务来源）。 */
  output: "pidesk:notification:output",
  /** 渲染层 → 主进程：展示系统桌面 toast（docs/design/24）。 */
  showToast: "pidesk:notification:showToast",
  /** 主进程 → 渲染层：用户点击了 toast，需聚焦并打开对应会话。 */
  activated: "pidesk:notification:activated",
} as const;

/** 主进程推送的播放请求；`gated` 表示 Host 已做 enabled 门禁。 */
export type NotificationPushMessage = NotificationPlayRequest & {
  gated?: boolean;
};

/** 渲染层请求展示桌面 toast 的载荷（文案由调用方按 locale 组装）。 */
export interface SystemToastRequest {
  title: string;
  body?: string;
  /** 触发源会话；点击回跳用。 */
  sessionId?: string;
  /** 已落盘的 JSONL 路径；与 sessionId 至少给一个才能回跳会话。 */
  sessionFile?: string;
}

/** 主进程 toast 点击推送。 */
export interface SystemToastActivated {
  sessionId?: string;
  sessionFile?: string;
}

function clampVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_NOTIFICATION_SETTINGS.volume;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeScenarioConfig(
  raw: unknown,
  fallback: NotificationScenarioConfig,
): NotificationScenarioConfig {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const item = raw as Partial<NotificationScenarioConfig>;
  return {
    enabled: typeof item.enabled === "boolean" ? item.enabled : fallback.enabled,
    sound: isNotificationSoundId(item.sound) ? item.sound : fallback.sound,
  };
}

/** 把磁盘上可能残缺/手改坏的 notification 字段收成合法配置。 */
export function normalizeNotificationSettings(raw: unknown): NotificationSettings {
  const fallback = DEFAULT_NOTIFICATION_SETTINGS;
  if (!raw || typeof raw !== "object") {
    return {
      ...fallback,
      scenarios: { ...fallback.scenarios },
    };
  }
  const data = raw as Partial<NotificationSettings>;
  const rawScenarios: Partial<Record<NotificationScenarioId, unknown>> =
    data.scenarios && typeof data.scenarios === "object"
      ? (data.scenarios as Partial<Record<NotificationScenarioId, unknown>>)
      : {};
  const scenarios = {} as Record<NotificationScenarioId, NotificationScenarioConfig>;
  for (const id of Object.keys(fallback.scenarios) as NotificationScenarioId[]) {
    scenarios[id] = normalizeScenarioConfig(rawScenarios[id], fallback.scenarios[id]);
  }
  return {
    enabled: typeof data.enabled === "boolean" ? data.enabled : fallback.enabled,
    volume: clampVolume(data.volume),
    focusPolicy:
      data.focusPolicy === "always" ||
      data.focusPolicy === "muteActiveFocused" ||
      data.focusPolicy === "muteWhenFocused"
        ? data.focusPolicy
        : fallback.focusPolicy,
    criticalIgnoresFocus:
      typeof data.criticalIgnoresFocus === "boolean"
        ? data.criticalIgnoresFocus
        : fallback.criticalIgnoresFocus,
    systemToast: typeof data.systemToast === "boolean" ? data.systemToast : fallback.systemToast,
    debounceMs:
      typeof data.debounceMs === "number" &&
      Number.isFinite(data.debounceMs) &&
      data.debounceMs >= 0 &&
      data.debounceMs <= 5000
        ? Math.floor(data.debounceMs)
        : fallback.debounceMs,
    scenarios,
  };
}

export interface NotificationGateContext {
  settings: NotificationSettings;
  scenario: NotificationScenarioId;
  /** 窗口/文档是否聚焦。 */
  windowFocused: boolean;
  /** 触发源会话；终端/试听可为空。 */
  sessionId?: string;
  /** 当前 UI 展示的 active 会话。 */
  activeSessionId?: string | null;
  /** 触发来源；extension 在用户已盯着当前会话时不走关键音旁路。 */
  source?: NotificationPlaySource;
}

/**
 * 是否应播放（不含防抖与全局 enabled 之外的资源问题）。
 * `source === "preview"` 由调用方直接绕过本函数。
 */
export function shouldPlayNotification(ctx: NotificationGateContext): boolean {
  const { settings, scenario } = ctx;
  if (!settings.enabled) return false;
  const cfg = settings.scenarios[scenario];
  if (!cfg?.enabled) return false;

  // 扩展在「用户正看着的会话」里弹确认框：UI 已在眼前，不按关键音强行打断
  const extensionInForeground =
    ctx.source === "extension" &&
    ctx.windowFocused &&
    (!ctx.sessionId || !ctx.activeSessionId || ctx.sessionId === ctx.activeSessionId);

  const critical =
    settings.criticalIgnoresFocus &&
    CRITICAL_NOTIFICATION_SCENARIOS.has(scenario) &&
    !extensionInForeground;
  if (critical) return true;

  if (settings.focusPolicy === "always") return true;
  if (settings.focusPolicy === "muteWhenFocused") {
    return !ctx.windowFocused;
  }
  // muteActiveFocused：聚焦且盯着触发源会话时静音；后台会话仍提示
  if (ctx.windowFocused) {
    if (ctx.sessionId && ctx.activeSessionId && ctx.sessionId === ctx.activeSessionId) {
      return false;
    }
    if (!ctx.sessionId) return false;
  }
  return true;
}
