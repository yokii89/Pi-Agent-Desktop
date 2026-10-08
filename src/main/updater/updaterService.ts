import { app } from "electron";
import { autoUpdater } from "electron-updater";
import {
  isVersionNewer,
  UPDATE_GITHUB_LATEST_API,
  UPDATE_IPC,
  type UpdateStatus,
} from "../../shared/update";
import { getMainWindow } from "../window/createMainWindow";

/** 启动静默检查的延迟：避开启动高峰，失败不打扰用户。 */
const STARTUP_CHECK_DELAY_MS = 8_000;

let status: UpdateStatus = { state: "idle" };
let wired = false;
/** electron-updater 检查互斥（事件回调与 await 共用）。 */
let checking = false;
/** 下载互斥：防双击 / 进度回调与 await 重入。 */
let downloading = false;
/** 本次检查是否静默：error 事件也要吞掉，不能只处理 promise catch。 */
let silentCheck = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

function pushStatus(next: UpdateStatus): void {
  status = next;
  getMainWindow()?.webContents.send(UPDATE_IPC.status, next);
}

/**
 * 静默失败时的落点：已有更“靠后”的状态就不要被打回 idle
 * （用户可能已点出 available / 正在下载）。
 */
function settleSilentFailure(): void {
  const s = status.state;
  if (s === "available" || s === "downloading" || s === "downloaded" || s === "error") {
    return;
  }
  pushStatus({ state: "idle" });
}

/** 当前状态（invoke 返回与 UI 初始值共用）。 */
export function getUpdateStatus(): UpdateStatus {
  return status;
}

function clampPercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * 接线 electron-updater 事件（幂等）。
 * `autoDownload=false`：下载由用户点「下载并安装」触发，符合手动检查语义。
 * `autoInstallOnAppQuit=true`：已下载后用户直接退出也会装上，避免下完白下。
 */
export function initUpdater(): void {
  if (wired) return;
  wired = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    if (!checking) pushStatus({ state: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    checking = false;
    pushStatus({
      state: "available",
      version: info.version,
      releaseDate: typeof info.releaseDate === "string" ? info.releaseDate : null,
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : null,
      canInstall: true,
    });
  });
  autoUpdater.on("update-not-available", () => {
    checking = false;
    pushStatus({ state: "not-available" });
  });
  autoUpdater.on("download-progress", (progress) => {
    pushStatus({ state: "downloading", percent: clampPercent(progress.percent) });
  });
  autoUpdater.on("update-downloaded", () => {
    downloading = false;
    pushStatus({ state: "downloaded" });
  });
  autoUpdater.on("error", (error) => {
    checking = false;
    downloading = false;
    const message = error instanceof Error ? error.message : String(error);
    if (silentCheck) {
      settleSilentFailure();
      return;
    }
    pushStatus({ state: "error", message });
  });
}

/** 开发 / 未打包：走 GitHub Releases API 比版本，只能提示，不能安装。 */
async function checkViaGitHubApi(): Promise<UpdateStatus> {
  pushStatus({ state: "checking" });
  const res = await fetch(UPDATE_GITHUB_LATEST_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "PiDesk-Updater",
    },
  });
  // 尚无任何 Release：当作“暂无更新”，避免启动静默检查/首次检查弹红字
  if (res.status === 404) {
    const next: UpdateStatus = { state: "not-available" };
    pushStatus(next);
    return next;
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}`);
  }
  const data = (await res.json()) as {
    tag_name?: string;
    published_at?: string;
    body?: string;
  };
  const remote = (data.tag_name ?? "").replace(/^v/i, "");
  const current = app.getVersion();
  if (!remote || !isVersionNewer(remote, current)) {
    const next: UpdateStatus = { state: "not-available" };
    pushStatus(next);
    return next;
  }
  const next: UpdateStatus = {
    state: "available",
    version: remote,
    releaseDate: data.published_at ?? null,
    releaseNotes: data.body ?? null,
    canInstall: false,
  };
  pushStatus(next);
  return next;
}

async function checkViaElectronUpdater(): Promise<UpdateStatus> {
  if (checking) return status;
  checking = true;
  pushStatus({ state: "checking" });
  try {
    // 事件回调会写入 available / not-available / error
    await autoUpdater.checkForUpdates();
    // 极少数路径 promise resolve 了却没事件：不能卡死在 checking
    if (status.state === "checking") {
      pushStatus({ state: "not-available" });
    }
    return status;
  } finally {
    checking = false;
  }
}

async function runCheck(options?: { silent?: boolean }): Promise<UpdateStatus> {
  silentCheck = options?.silent === true;
  try {
    if (!app.isPackaged) {
      return await checkViaGitHubApi();
    }
    return await checkViaElectronUpdater();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options?.silent) {
      settleSilentFailure();
      return status;
    }
    const next: UpdateStatus = { state: "error", message };
    pushStatus(next);
    return next;
  } finally {
    silentCheck = false;
  }
}

let checkInFlight: Promise<UpdateStatus> | null = null;

/**
 * 检查更新（手动按钮 / 启动静默共用）。
 * `silent`：失败时不向用户展示错误，也不把已有 available/下载中状态打回 idle。
 */
export function checkForUpdates(options?: { silent?: boolean }): Promise<UpdateStatus> {
  initUpdater();
  if (checkInFlight) return checkInFlight;
  checkInFlight = runCheck(options).finally(() => {
    checkInFlight = null;
  });
  return checkInFlight;
}

/** 下载更新安装包；仅打包环境可用。 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  initUpdater();
  if (!app.isPackaged) {
    const next: UpdateStatus = {
      state: "error",
      message: "Development build cannot install updates",
    };
    pushStatus(next);
    return next;
  }
  // 检查中 / 已下载 / 下载中：直接返回当前状态，避免 electron-updater 重入
  if (
    status.state === "checking" ||
    status.state === "downloading" ||
    status.state === "downloaded"
  ) {
    return status;
  }
  if (downloading) return status;
  downloading = true;
  pushStatus({ state: "downloading", percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
    return status;
  } catch (err) {
    downloading = false;
    const next: UpdateStatus = {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    pushStatus(next);
    return next;
  }
}

/** 退出并安装（需已下载完成）。 */
export function installUpdate(): void {
  if (status.state !== "downloaded") {
    throw new Error("Update has not been downloaded yet");
  }
  // isSilent=false：NSIS oneClick=false，保留安装向导；isForceRunAfter=true：装完拉起新版
  autoUpdater.quitAndInstall(false, true);
}

/** 启动后延迟静默检查一次（docs/design/35）。用户已交互则跳过，避免覆盖进行中状态。 */
export function scheduleStartupCheck(): void {
  initUpdater();
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = setTimeout(() => {
    startupTimer = null;
    if (status.state !== "idle") return;
    void checkForUpdates({ silent: true }).catch(() => {});
  }, STARTUP_CHECK_DELAY_MS);
}

/** 退出时清掉未触发的静默检查定时器。 */
export function disposeUpdater(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
}
