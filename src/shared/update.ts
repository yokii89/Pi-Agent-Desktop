/**
 * 应用更新（docs/design/35）：状态机、IPC channel 与版本比较纯函数。
 * 检查/下载/安装在主进程 updaterService；渲染层只消费状态与发起 invoke。
 */

/** 更新状态机（docs/design/35 §4）。 */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "not-available" }
  | {
      state: "available";
      /** 远端版本号（不含 v 前缀）。 */
      version: string;
      releaseDate: string | null;
      releaseNotes: string | null;
      /** false = 未打包，只能打开下载页。 */
      canInstall: boolean;
    }
  | { state: "downloading"; percent: number }
  | { state: "downloaded" }
  | { state: "error"; message: string };

export const UPDATE_IPC = {
  /** 读取 `app.getVersion()`（package.json version，与安装包一致）。 */
  getVersion: "pidesk:update:getVersion",
  /** 手动 / 静默检查更新。 */
  check: "pidesk:update:check",
  /** 启动下载；未打包时由渲染层改走 openExternal。 */
  download: "pidesk:update:download",
  /** 下载完成后退出并安装。 */
  install: "pidesk:update:install",
  /** 读取当前状态快照（订阅 push 前对账）。 */
  getStatus: "pidesk:update:getStatus",
  /** 主进程推送：状态机迁移与下载进度。 */
  status: "pidesk:update:status",
} as const;

/** 发布页 URL（开发模式降级「打开下载页」、错误兜底）。 */
export const UPDATE_RELEASES_URL = "https://github.com/yokii89/Pi-Agent-Desktop/releases";

/** GitHub Releases API（开发模式检查用；仓库需可匿名读 Releases）。 */
export const UPDATE_GITHUB_LATEST_API =
  "https://api.github.com/repos/yokii89/Pi-Agent-Desktop/releases/latest";

/**
 * 解析 `v1.2.3` / `1.2.3-beta.1` 为数值段。
 * 非法输入返回 null；pre-release 标识忽略（latest 通道只比数值三元组）。
 */
export function parseVersionParts(version: string): [number, number, number] | null {
  const core = version.trim().replace(/^v/i, "").split("-")[0] ?? "";
  const parts = core.split(".");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : Number.NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [major = 0, minor = 0, patch = 0] = nums as number[];
  return [major, minor, patch];
}

/** `remote` 是否严格新于 `current`；解析失败视为不更新。 */
export function isVersionNewer(remote: string, current: string): boolean {
  const r = parseVersionParts(remote);
  const c = parseVersionParts(current);
  if (!r || !c) return false;
  for (let i = 0; i < 3; i += 1) {
    const rv = r[i] ?? 0;
    const cv = c[i] ?? 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}
