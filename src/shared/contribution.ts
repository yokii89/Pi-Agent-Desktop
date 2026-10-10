/**
 * Contribution Catalog / Runtime / Activation 共享契约（docs/design/16）。
 * 三类事实必须分开：Catalog=能力事实，Runtime=会话进程事实，Projection=渲染合并结果。
 */

import type { SessionId } from "./ipc";

export type { SessionId };

// ---------------------------------------------------------------------------
// Contribution Catalog
// ---------------------------------------------------------------------------

/** Catalog 条目的挂载位置。仅这些 placement 进入静态目录。 */
export type ContributionPlacement =
  | "access-mode"
  | "settings"
  | "widget"
  | "header"
  | "sidebar"
  | "panel";

/** 扩展声明的激活条件。 */
export type ContributionActivation = "onAccessMode" | "onSettingsView" | "onSessionView";

export type ContributionAccent = "default" | "warning" | "success" | "danger";

/** 宿主允许的 Phosphor 图标映射名（manifest.icon 只能取自这里）。 */
export const CONTRIBUTION_ICONS: ReadonlySet<string> = new Set([
  "shield",
  "shield-check",
  "clipboard",
  "gear",
  "gear-six",
  "sliders",
  "puzzle-piece",
  "sparkle",
  "warning",
  "check-circle",
  "info",
]);

/** 单包贡献数量上限；超出项跳过并记诊断。 */
export const CONTRIBUTION_LIMITS = {
  maxPerPackage: 32,
  maxTitleLength: 80,
  maxDescriptionLength: 400,
  maxIdLength: 64,
  maxIconLength: 40,
} as const;

/**
 * 静态能力目录条目。
 * 不携带 active/detail 等运行时真值——那是 Session pi 的职责。
 */
export interface ExtensionContribution {
  /** 跨进程稳定 opaque key；含 context/scope/package identity/placement/id。 */
  key: string;
  catalogContextId: string;
  /** 包展示身份（npm 名 / git host/path / local basename）。 */
  packageId: string;
  extensionId?: string;
  scope: "user" | "project";
  /** 仅 scope=project 时存在；渲染层可用其哈希，不强制展示原始路径。 */
  projectDir?: string;
  placement: ContributionPlacement;
  /** 扩展内部贡献 id（access-mode 下即 mode.id）。 */
  id: string;
  title: string;
  description?: string;
  icon?: string;
  accent?: ContributionAccent;
  activation: ContributionActivation;
  /** pidesk.worker.safe；默认 false。 */
  workerSafe: boolean;
  packageVersion?: string;
}

/** 按上下文保存的 Catalog 快照（user + 规范化项目根）。 */
export interface ContributionCatalogSnapshot {
  /** user + 规范化项目根生成；不直接向渲染层暴露原始绝对路径语义。 */
  contextId: string;
  projectDir?: string;
  /** 包启停/版本等派生指纹，用于 stale 标记。 */
  fingerprint: string;
  entries: ExtensionContribution[];
  /** 扫描时产生的非法项诊断（不阻断其它包）。 */
  diagnostics: ContributionDiagnostic[];
}

export interface ContributionDiagnostic {
  packageId: string;
  scope: "user" | "project";
  /** 人类可读原因。 */
  message: string;
  field?: string;
}

// ---------------------------------------------------------------------------
// Session Runtime
// ---------------------------------------------------------------------------

/** Session pi 运行时状态机（docs/design/16 §6.1）。 */
export type SessionRuntimeState =
  | "cold"
  | "starting"
  | "ready"
  | "idle"
  | "busy"
  | "stopping"
  | "failed";

/** 启动原因；P0 用于日志/失败反馈，未来调度也以此为依据。 */
export type SessionStartReason =
  | "send"
  | "view-action"
  | "slash-command"
  | "manual"
  | "speculative-prefetch"
  /** 新会话预热（docs/design/44 A2）：无 sessionFile 的待用实例，未晋升前对渲染层不可见。 */
  | "new-chat-prefetch"
  | "scheduled";

/** 主进程 runtime 快照条目（Renderer reload 后对账用）。 */
export interface SessionRuntimeSnapshot {
  sessionId: SessionId;
  sessionFile: string | null;
  cwd: string | null;
  state: SessionRuntimeState;
  /** 最近一次 start 的原因。 */
  reason: SessionStartReason | null;
  /** 创建者；speculative 实例可被自动回收，user-owned 不可。 */
  createdBy: SessionStartReason | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  /** 该进程启动时使用的 extension Catalog fingerprint。 */
  extensionFingerprint: string | null;
  /** fingerprint 已过期（扩展启停/升级后）；只作提示，不中断 busy。 */
  staleExtension: boolean;
  /** failed 时的结构化错误。 */
  errorCode?: SessionRuntimeErrorCode;
  errorMessage?: string;
}

export type SessionRuntimeErrorCode =
  | "spawn-failed"
  | "runtime-ready-timeout"
  | "limit-reached"
  | "shutting-down"
  | "protocol-init-failed";

/** 结构化并发上限错误（替换纯字符串匹配）。 */
export interface SessionLimitReachedError {
  code: "limit-reached";
  limit: number;
  /** 可结束的 idle 实例 id（用户可操作反馈）。 */
  idleCandidateIds: SessionId[];
  message: string;
}

// ---------------------------------------------------------------------------
// Contribution Activation
// ---------------------------------------------------------------------------

/** 渲染层贡献投影状态（docs/design/16 §6.2）。 */
export type ContributionViewState = "advertised" | "activating" | "live" | "suspended" | "failed";

/** 访问模式选择三态（docs/design/16 §6.3）。 */
export type AccessModeSelectionState = "confirmed-full" | "confirmed-extension" | "unresolved";

/**
 * 激活动作。
 * - `mode:*`：access-mode 专用，发 action 后等 `mode.active` 确认。
 * - `view:open`：panel / settings 冷态入口——ensureSession → 等 live 注册即成功
 *   （不发 mode 指令；docs/design/19 §10.1/§10.2）。
 */
export type ActivateContributionAction = "mode:activate" | "mode:deactivate" | "view:open";

export type ActivateContributionErrorCode =
  | "catalog-missing"
  | "runtime-start-failed"
  | "runtime-ready-timeout"
  | "contribution-not-registered"
  | "activation-not-confirmed"
  | "limit-reached"
  | "activation-rejected"
  | "activation-in-progress"
  | "invalid-request";

export interface ActivateContributionRequest {
  contributionKey: string;
  /** 新建空会话尚无运行时 id 时可省略，由协调器创建并返回。 */
  sessionId?: SessionId;
  sessionFile?: string;
  cwd?: string;
  actionId: ActivateContributionAction;
}

export interface ActivateContributionResult {
  sessionId: SessionId;
  contributionKey: string;
  liveViewId: string;
  state: "active" | "inactive";
  detail?: string;
}

/** 激活失败时随错误返回的结构化信息。 */
export interface ActivateContributionFailure {
  code: ActivateContributionErrorCode;
  message: string;
  sessionId?: SessionId;
  contributionKey?: string;
  /** limit-reached 时可操作的 idle 会话。 */
  limit?: number;
  idleCandidateIds?: SessionId[];
}

// ---------------------------------------------------------------------------
// IPC channels
// ---------------------------------------------------------------------------

export const CATALOG_IPC = {
  /** 读取指定上下文（或当前项目）的 Catalog 快照。 */
  list: "pidesk:catalog:list",
  /** 强制重扫；可按 contextId 失效，缺省失效全部。 */
  refresh: "pidesk:catalog:refresh",
  /** 主进程推送：Catalog 快照变化。 */
  changed: "pidesk:catalog:changed",
} as const;

export const RUNTIME_IPC = {
  /** 读取主进程权威 runtime 快照（Renderer reload 对账）。 */
  snapshot: "pidesk:runtime:snapshot",
  /** 主进程推送：runtime 条目变化。 */
  changed: "pidesk:runtime:changed",
} as const;

export const VIEW_ACTIVATE_IPC = {
  /** 原子激活 Contribution：ensure → ready → wait live → action → confirm。 */
  activateContribution: "pidesk:view:activateContribution",
} as const;

/** Extension Worker lease（docs/design/16 Phase F）。 */
export const WORKER_IPC = {
  /** 设置「来自扩展」打开时获取 lease；必要时按需启动 Worker。 */
  acquire: "pidesk:worker:acquire",
  /** 关闭设置后释放 lease；宽限期内无新 lease 才退出。 */
  release: "pidesk:worker:release",
  /** Worker 状态（调试 / 设置页展示）。 */
  status: "pidesk:worker:status",
} as const;

/** Worker 运行状态快照。 */
export interface ExtensionWorkerStatus {
  running: boolean;
  ready: boolean;
  /** 当前 lease 计数。 */
  leases: number;
  /** 宽限退出倒计时是否已排程。 */
  graceExitScheduled: boolean;
  /** 可加载的 worker-safe 扩展入口数。 */
  workerSafeExtensionCount: number;
  /** pi 是否支持选择性加载（spike：`-ne` + `-e`）。 */
  selectiveLoadSupported: boolean;
  /** worker-safe 扩展入口路径（诊断）。 */
  extensionPaths: string[];
  errorMessage?: string;
}

export interface WorkerAcquireResult {
  status: ExtensionWorkerStatus;
}

/** speculative 预热指标（docs/design/16 Phase G）。 */
export const PREFETCH_IPC = {
  /** 读取 view-action ready 延迟样本与 prefetch 统计。 */
  metrics: "pidesk:prefetch:metrics",
  /** 主进程通知：active 会话稳定后可能预热（渲染层 open/switch 时调用）。 */
  notifyActive: "pidesk:prefetch:notifyActive",
} as const;

export interface PrefetchNotifyRequest {
  sessionId?: SessionId;
  sessionFile?: string | null;
  cwd?: string | null;
  /**
   * 触发意图（docs/design/44 A1）：`open` = 用户明确打开/新建该会话，
   * 用短 dwell 且不因其它会话 busy/starting 而跳过；缺省按 `idle`（弱信号）处理。
   */
  intent?: "open" | "idle";
}

export interface PrefetchMetrics {
  /** 是否启用 speculative 预热。 */
  enabled: boolean;
  /** view-action → runtime ready 延迟样本（ms，最多保留 50 条）。 */
  viewActionReadyMs: number[];
  p50ReadyMs: number | null;
  p95ReadyMs: number | null;
  /** send → runtime ready 延迟样本（ms，最多保留 50 条）。 */
  sendReadyMs: number[];
  p50SendReadyMs: number | null;
  p95SendReadyMs: number | null;
  /** 显式启动时实例已 ready（命中）/ 未 ready（含在途预热）的次数。 */
  prefetchHits: number;
  prefetchMisses: number;
  /** 预热发起次数 / 因额度跳过次数 / 回收次数。 */
  prefetchAttempts: number;
  prefetchSkippedLimit: number;
  speculativeReclaimed: number;
  /** 当前 speculative 存活数。 */
  speculativeAlive: number;
}

/** 激活事务默认超时（ms），集中在主进程，组件内禁止写裸数字。 */
export const ACTIVATION_TIMEOUTS = {
  spawnAndReady: 15_000,
  contributionRegister: 8_000,
  activationConfirm: 5_000,
} as const;

/** Runtime ready 探针超时。 */
export const RUNTIME_READY_TIMEOUT_MS = 15_000;

/** Extension Worker 宽限退出（ms）。 */
export const WORKER_GRACE_EXIT_MS = 45_000;

/** speculative 预热：active 会话稳定停留多久后尝试（ms）。 */
export const PREFETCH_STABLE_MS = 2_500;

/** speculative 预热：用户明确打开/新建会话后的触发延迟（ms，docs/design/44 A1）。 */
export const PREFETCH_OPEN_DWELL_MS = 350;
