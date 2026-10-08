/**
 * GitHub 登录与设置同步的共享类型 / IPC channel（docs/design/36）。
 * token 本身永不进入渲染层；此处只暴露 profile 与同步状态。
 */
import type { SettingsSyncEnvelope } from "./settingsSync";

/** GitHub 用户档案（GET /user 白名单字段）。 */
export interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string;
  /**
   * 头像 data URL（主进程下载后转码）。
   * 渲染层 CSP `img-src 'self' data:` 拒绝外链，只能用 data URL 展示。
   */
  avatarDataUrl: string | null;
  htmlUrl: string;
}

export type GitHubAuthStatus = "signed-out" | "device-pending" | "authenticated" | "error";

/** 渲染层可见的认证状态（不含 token）。 */
export interface GitHubAuthState {
  status: GitHubAuthStatus;
  profile: GitHubProfile | null;
  /** Secret Gist id；未创建/未发现时为 null。 */
  gistId: string | null;
  /** 上次成功 push/pull 的 Unix ms。 */
  lastSyncAt: number | null;
  /** 上次同步来源设备名（远端写入的 deviceName；push 时为本机名）。 */
  lastSyncDeviceName: string | null;
  lastSyncDirection: "push" | "pull" | null;
  /** 未配置 OAuth client_id 等基础设施问题的说明。 */
  configError: string | null;
}

/** Device Flow 开始后展示给用户的验证码信息。 */
export interface GitHubDeviceStart {
  userCode: string;
  verificationUri: string;
  /** 带 code 的一键打开地址（verification_uri_complete）。 */
  verificationUriComplete: string;
  expiresAt: number;
  /** 建议轮询间隔（ms）。 */
  intervalMs: number;
}

export type GitHubDevicePhase =
  | "idle"
  | "pending"
  | "authorized"
  | "failed"
  | "cancelled"
  | "expired";

/** Device Flow 过程状态（主进程推送）。 */
export interface GitHubDeviceStatus {
  phase: GitHubDevicePhase;
  /** pending 时的验证码，供 UI 保持展示。 */
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  expiresAt?: number;
  profile?: GitHubProfile | null;
  error?: string | null;
  /** authorized 后自动 pull 的结果；未自动同步（无 Gist / 远端较旧 / 失败）为 null。 */
  autoSync?: GitHubSyncResult | null;
}

export type GitHubSyncDirection = "push" | "pull";

export interface GitHubSyncResult {
  direction: GitHubSyncDirection;
  gistId: string | null;
  syncedAt: number;
  deviceName: string;
  /** pull 时实际写入本地的键；push 为已上传的键列表。 */
  keys: string[];
  /** pull 时远端 updatedAt；push 为本次写入的 updatedAt。 */
  remoteUpdatedAt: number;
  /** pull：远端是否比本地 lastSyncAt 更新。 */
  remoteWasNewer: boolean;
  /** pull 且远端较旧时为 true（已按用户确认强制拉取）。 */
  forced: boolean;
}

/** 下载前差异预览中的一条键。 */
export interface GitHubSyncChange {
  key: string;
  /** 本地值摘要（复杂值为「对象」/「列表」等短文案）。 */
  local: string;
  remote: string;
}

/** pull 前的差异预览（docs/design/36 P1）。 */
export interface GitHubSyncPreview {
  gistId: string;
  remoteUpdatedAt: number;
  remoteDeviceName: string;
  /** 相对本机 lastSyncAt；false 时 pull 需 force。 */
  remoteWasNewer: boolean;
  /** 仅列出有差异的键；空数组 = 内容一致。 */
  changes: GitHubSyncChange[];
}

/** 设置同步元信息（附在 AuthState 上即可，单独类型便于扩展）。 */
export type GitHubSyncEnvelope = SettingsSyncEnvelope;

export const GITHUB_IPC = {
  deviceStart: "pidesk:github:deviceStart",
  deviceCancel: "pidesk:github:deviceCancel",
  /** 主进程推送 Device Flow 状态。 */
  deviceStatus: "pidesk:github:deviceStatus",
  getAuth: "pidesk:github:getAuth",
  logout: "pidesk:github:logout",
  syncPush: "pidesk:github:syncPush",
  syncPull: "pidesk:github:syncPull",
  /** 下载前差异预览（不写本地）。 */
  syncPreview: "pidesk:github:syncPreview",
} as const;
